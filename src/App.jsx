import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { supabase } from "./lib/supabase";

const portionWeight = {
  small: 1,
  medium: 1.5,
  large: 2
};

function toInputDateTime(dateValue) {
  if (!dateValue) return "";
  const d = new Date(dateValue);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function formatDate(dateValue) {
  return new Date(dateValue).toLocaleDateString();
}

function formatDateTime(dateValue) {
  return new Date(dateValue).toLocaleString();
}

function isBeforeDeadline(deadline) {
  return new Date() <= new Date(deadline);
}

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [appLoading, setAppLoading] = useState(true);

  const [authForm, setAuthForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "user"
  });

  const [meals, setMeals] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [wasteLogs, setWasteLogs] = useState([]);

  const [portionByMeal, setPortionByMeal] = useState({});
  const [mealForm, setMealForm] = useState({
    id: "",
    date: "",
    type: "breakfast",
    menu_items: "",
    booking_deadline: ""
  });
  const [wasteForm, setWasteForm] = useState({
    meal_id: "",
    prepared_quantity: "",
    consumed_quantity: "",
    date: ""
  });

  const isAdmin = profile?.role === "admin";

  useEffect(() => {
    const initAuth = async () => {
      const {
        data: { session: activeSession }
      } = await supabase.auth.getSession();
      setSession(activeSession);
      if (activeSession?.user) {
        await loadProfile(activeSession.user.id);
      }
      setAppLoading(false);
    };

    initAuth();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        await loadProfile(newSession.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user || !profile) {
      return;
    }
    void loadAllData();

    const channel = supabase
      .channel("meal-prebooking-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "meals" },
        () => void loadAllData()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings" },
        () => void loadAllData()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "waste_logs" },
        () => void loadAllData()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [session?.user, profile?.role]);

  async function loadProfile(userId) {
    const { data, error } = await supabase.from("users").select("*").eq("id", userId).single();
    if (error) {
      setAuthError(error.message);
      return;
    }
    setProfile(data);
  }

  async function loadAllData() {
    setAppLoading(true);

    const mealsQuery = supabase.from("meals").select("*").order("date", { ascending: true });

    const bookingsQuery = isAdmin
      ? supabase.from("bookings").select("*")
      : supabase.from("bookings").select("*").eq("user_id", session.user.id);

    const wasteQuery = isAdmin
      ? supabase.from("waste_logs").select("*").order("date", { ascending: true })
      : supabase
          .from("waste_logs")
          .select("*")
          .order("date", { ascending: true });

    const [{ data: mealsData, error: mealsError }, { data: bookingsData, error: bookingsError }, { data: wasteData, error: wasteError }] =
      await Promise.all([mealsQuery, bookingsQuery, wasteQuery]);

    if (mealsError || bookingsError || wasteError) {
      setAuthError(mealsError?.message || bookingsError?.message || wasteError?.message || "Failed to load data");
      setAppLoading(false);
      return;
    }

    setMeals(mealsData || []);
    setBookings(bookingsData || []);
    setWasteLogs(wasteData || []);
    setAppLoading(false);
  }

  async function handleSignup(e) {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError("");

    const { data, error } = await supabase.auth.signUp({
      email: authForm.email,
      password: authForm.password
    });

    if (error) {
      setAuthError(error.message);
      setAuthLoading(false);
      return;
    }

    if (data.user) {
      const { error: profileError } = await supabase.from("users").insert({
        id: data.user.id,
        name: authForm.name,
        role: authForm.role
      });

      if (profileError) {
        setAuthError(profileError.message);
      }
    }

    setAuthLoading(false);
  }

  async function handleLogin(e) {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError("");

    const { error } = await supabase.auth.signInWithPassword({
      email: authForm.email,
      password: authForm.password
    });

    if (error) {
      setAuthError(error.message);
    }

    setAuthLoading(false);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setBookings([]);
    setMeals([]);
    setWasteLogs([]);
  }

  async function handleBookMeal(mealId) {
    const selectedPortion = portionByMeal[mealId];
    if (!selectedPortion) {
      setAuthError("Select a portion size first.");
      return;
    }

    const meal = meals.find((item) => item.id === mealId);
    if (!meal || !isBeforeDeadline(meal.booking_deadline)) {
      setAuthError("Booking deadline has passed.");
      return;
    }

    const { data: existing } = await supabase
      .from("bookings")
      .select("id")
      .eq("user_id", session.user.id)
      .eq("meal_id", mealId)
      .eq("status", "confirmed")
      .maybeSingle();

    if (existing) {
      setAuthError("You already have a confirmed booking for this meal.");
      return;
    }

    const { error } = await supabase.from("bookings").insert({
      user_id: session.user.id,
      meal_id: mealId,
      portion_size: selectedPortion,
      status: "confirmed"
    });

    if (error) {
      setAuthError(error.message);
      return;
    }

    setAuthError("");
    await loadAllData();
  }

  async function handleCancelBooking(bookingId) {
    const { error } = await supabase.from("bookings").update({ status: "cancelled" }).eq("id", bookingId);
    if (error) {
      setAuthError(error.message);
      return;
    }
    await loadAllData();
  }

  async function handleSaveMeal(e) {
    e.preventDefault();
    const payload = {
      date: mealForm.date,
      type: mealForm.type,
      menu_items: mealForm.menu_items.split(",").map((s) => s.trim()).filter(Boolean),
      booking_deadline: new Date(mealForm.booking_deadline).toISOString()
    };

    const query = mealForm.id
      ? supabase.from("meals").update(payload).eq("id", mealForm.id)
      : supabase.from("meals").insert(payload);

    const { error } = await query;
    if (error) {
      setAuthError(error.message);
      return;
    }

    setMealForm({
      id: "",
      date: "",
      type: "breakfast",
      menu_items: "",
      booking_deadline: ""
    });
    await loadAllData();
  }

  function startEditMeal(meal) {
    setMealForm({
      id: meal.id,
      date: meal.date,
      type: meal.type,
      menu_items: Array.isArray(meal.menu_items) ? meal.menu_items.join(", ") : meal.menu_items,
      booking_deadline: toInputDateTime(meal.booking_deadline)
    });
  }

  async function deleteMeal(mealId) {
    const { error } = await supabase.from("meals").delete().eq("id", mealId);
    if (error) {
      setAuthError(error.message);
      return;
    }
    await loadAllData();
  }

  async function saveWasteLog(e) {
    e.preventDefault();

    const prepared = Number(wasteForm.prepared_quantity);
    const consumed = Number(wasteForm.consumed_quantity);
    const wasted = Math.max(prepared - consumed, 0);

    const payload = {
      meal_id: wasteForm.meal_id,
      prepared_quantity: prepared,
      consumed_quantity: consumed,
      wasted_quantity: wasted,
      date: wasteForm.date
    };

    const { data: existing } = await supabase
      .from("waste_logs")
      .select("id")
      .eq("meal_id", wasteForm.meal_id)
      .eq("date", wasteForm.date)
      .maybeSingle();

    const query = existing
      ? supabase.from("waste_logs").update(payload).eq("id", existing.id)
      : supabase.from("waste_logs").insert(payload);

    const { error } = await query;
    if (error) {
      setAuthError(error.message);
      return;
    }

    setWasteForm({ meal_id: "", prepared_quantity: "", consumed_quantity: "", date: "" });
    await loadAllData();
  }

  const mealBookingStats = useMemo(() => {
    return meals.map((meal) => {
      const rows = bookings.filter((booking) => booking.meal_id === meal.id && booking.status === "confirmed");
      const totalBookings = rows.length;
      const requiredQuantity = rows.reduce((sum, row) => sum + (portionWeight[row.portion_size] || 1), 0);

      return {
        meal,
        totalBookings,
        requiredQuantity
      };
    });
  }, [meals, bookings]);

  const userBookingsWithMeal = useMemo(() => {
    return bookings
      .filter((booking) => booking.user_id === session?.user?.id)
      .map((booking) => ({
        ...booking,
        meal: meals.find((meal) => meal.id === booking.meal_id)
      }))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [bookings, meals, session?.user?.id]);

  const bookedVsPreparedData = useMemo(() => {
    return mealBookingStats.map((row) => {
      const log = wasteLogs.find((item) => item.meal_id === row.meal.id);
      return {
        label: `${row.meal.type}-${row.meal.date}`,
        booked: row.totalBookings,
        prepared: log?.prepared_quantity || 0
      };
    });
  }, [mealBookingStats, wasteLogs]);

  const wasteTrendData = useMemo(() => {
    return wasteLogs.map((log) => {
      const pct = log.prepared_quantity > 0 ? (log.wasted_quantity / log.prepared_quantity) * 100 : 0;
      return {
        date: log.date,
        wastePercentage: Number(pct.toFixed(2)),
        highWaste: pct >= 20
      };
    });
  }, [wasteLogs]);

  const wasteInsight = useMemo(() => {
    if (!wasteTrendData.length) return "No waste data yet.";
    const averageWaste = wasteTrendData.reduce((sum, d) => sum + d.wastePercentage, 0) / wasteTrendData.length;
    if (averageWaste <= 0) return "No measurable waste currently.";
    return `Reduce preparation by approximately ${averageWaste.toFixed(1)}% based on recent waste patterns.`;
  }, [wasteTrendData]);

  const prediction = useMemo(() => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const total = bookings.filter((booking) => {
      const createdAt = new Date(booking.created_at);
      return booking.status === "confirmed" && createdAt >= sevenDaysAgo;
    }).length;

    return Math.round(total / 7);
  }, [bookings]);

  if (appLoading) {
    return (
      <div className="min-h-screen bg-surface text-ink grid place-items-center">
        <p className="text-lg font-semibold">Loading application...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-surface px-4 py-10 md:px-8">
        <div className="mx-auto max-w-5xl rounded-3xl bg-gradient-to-br from-moss to-ink p-8 text-white shadow-2xl md:p-10">
          <h1 className="font-serif text-3xl md:text-5xl">Meal Pre-Booking System</h1>
          <p className="mt-3 max-w-2xl text-sm text-stone-200 md:text-base">
            Real-time meal planning with food waste monitoring, booking intelligence, and role-aware controls.
          </p>

          <div className="mt-8 rounded-2xl bg-white/95 p-6 text-ink backdrop-blur md:p-8">
            <div className="mb-4 flex gap-2">
              <button
                className={`rounded-xl px-4 py-2 text-sm font-semibold ${authMode === "login" ? "bg-coral text-white" : "bg-stone-200"}`}
                onClick={() => setAuthMode("login")}
              >
                Login
              </button>
              <button
                className={`rounded-xl px-4 py-2 text-sm font-semibold ${authMode === "signup" ? "bg-coral text-white" : "bg-stone-200"}`}
                onClick={() => setAuthMode("signup")}
              >
                Sign Up
              </button>
            </div>

            <form className="grid gap-4" onSubmit={authMode === "signup" ? handleSignup : handleLogin}>
              {authMode === "signup" && (
                <input
                  className="rounded-xl border border-stone-300 px-3 py-2"
                  type="text"
                  placeholder="Full name"
                  required
                  value={authForm.name}
                  onChange={(e) => setAuthForm((prev) => ({ ...prev, name: e.target.value }))}
                />
              )}

              <input
                className="rounded-xl border border-stone-300 px-3 py-2"
                type="email"
                placeholder="Email"
                required
                value={authForm.email}
                onChange={(e) => setAuthForm((prev) => ({ ...prev, email: e.target.value }))}
              />

              <input
                className="rounded-xl border border-stone-300 px-3 py-2"
                type="password"
                placeholder="Password"
                required
                value={authForm.password}
                onChange={(e) => setAuthForm((prev) => ({ ...prev, password: e.target.value }))}
              />

              {authMode === "signup" && (
                <select
                  className="rounded-xl border border-stone-300 px-3 py-2"
                  value={authForm.role}
                  onChange={(e) => setAuthForm((prev) => ({ ...prev, role: e.target.value }))}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              )}

              <button className="rounded-xl bg-coral px-4 py-2 font-semibold text-white" disabled={authLoading}>
                {authLoading ? "Please wait..." : authMode === "signup" ? "Create account" : "Login"}
              </button>
              {authError && <p className="text-sm text-red-600">{authError}</p>}
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface px-4 py-6 text-ink md:px-8">
      <header className="mx-auto mb-6 flex max-w-7xl flex-col gap-3 rounded-2xl bg-white p-5 shadow md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-serif text-2xl md:text-3xl">Meal Pre-Booking and Waste Monitor</h1>
          <p className="text-sm text-stone-600">
            Signed in as <span className="font-semibold">{profile?.name || session.user.email}</span> ({profile?.role})
          </p>
        </div>
        <button onClick={handleLogout} className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white">
          Logout
        </button>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-2">
        <section className="rounded-2xl bg-white p-5 shadow">
          <h2 className="text-xl font-bold">Upcoming Meals</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {meals.map((meal) => {
              const alreadyBooked = bookings.some(
                (booking) =>
                  booking.meal_id === meal.id && booking.user_id === session.user.id && booking.status === "confirmed"
              );
              return (
                <article key={meal.id} className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                  <p className="text-sm font-semibold uppercase text-moss">
                    {meal.type} - {formatDate(meal.date)}
                  </p>
                  <p className="mt-2 text-sm text-stone-700">
                    {Array.isArray(meal.menu_items) ? meal.menu_items.join(", ") : meal.menu_items}
                  </p>
                  <p className="mt-2 text-xs text-stone-500">Deadline: {formatDateTime(meal.booking_deadline)}</p>

                  {!isAdmin && (
                    <>
                      <div className="mt-3 flex gap-2 text-xs">
                        {["small", "medium", "large"].map((portion) => (
                          <button
                            key={portion}
                            className={`rounded-lg px-3 py-1 font-semibold capitalize ${
                              portionByMeal[meal.id] === portion ? "bg-moss text-white" : "bg-stone-200"
                            }`}
                            onClick={() =>
                              setPortionByMeal((prev) => ({
                                ...prev,
                                [meal.id]: portion
                              }))
                            }
                          >
                            {portion}
                          </button>
                        ))}
                      </div>

                      <button
                        onClick={() => handleBookMeal(meal.id)}
                        disabled={alreadyBooked || !isBeforeDeadline(meal.booking_deadline)}
                        className="mt-3 w-full rounded-lg bg-coral px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-stone-400"
                      >
                        {alreadyBooked ? "Booked" : isBeforeDeadline(meal.booking_deadline) ? "Book meal" : "Deadline passed"}
                      </button>
                    </>
                  )}

                  {isAdmin && (
                    <div className="mt-3 flex gap-2 text-xs">
                      <button
                        className="rounded-lg bg-amber px-3 py-1 font-semibold text-white"
                        onClick={() => startEditMeal(meal)}
                      >
                        Edit
                      </button>
                      <button
                        className="rounded-lg bg-red-600 px-3 py-1 font-semibold text-white"
                        onClick={() => deleteMeal(meal.id)}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        {!isAdmin && (
          <section className="rounded-2xl bg-white p-5 shadow">
            <h2 className="text-xl font-bold">Your Booking History</h2>
            <div className="mt-4 space-y-3">
              {userBookingsWithMeal.map((booking) => (
                <div key={booking.id} className="rounded-xl border border-stone-200 p-4">
                  <p className="text-sm font-semibold">
                    {booking.meal?.type || "meal"} - {booking.meal?.date || "N/A"}
                  </p>
                  <p className="mt-1 text-xs text-stone-600">
                    Portion: {booking.portion_size} | Status: {booking.status}
                  </p>
                  {booking.status === "confirmed" && booking.meal?.booking_deadline && isBeforeDeadline(booking.meal.booking_deadline) && (
                    <button
                      onClick={() => handleCancelBooking(booking.id)}
                      className="mt-2 rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white"
                    >
                      Cancel Booking
                    </button>
                  )}
                </div>
              ))}
              {!userBookingsWithMeal.length && <p className="text-sm text-stone-500">No bookings yet.</p>}
            </div>
          </section>
        )}

        {isAdmin && (
          <>
            <section className="rounded-2xl bg-white p-5 shadow">
              <h2 className="text-xl font-bold">Meal Management</h2>
              <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={handleSaveMeal}>
                <input
                  className="rounded-lg border border-stone-300 px-3 py-2"
                  type="date"
                  required
                  value={mealForm.date}
                  onChange={(e) => setMealForm((prev) => ({ ...prev, date: e.target.value }))}
                />
                <select
                  className="rounded-lg border border-stone-300 px-3 py-2"
                  value={mealForm.type}
                  onChange={(e) => setMealForm((prev) => ({ ...prev, type: e.target.value }))}
                >
                  <option value="breakfast">Breakfast</option>
                  <option value="lunch">Lunch</option>
                  <option value="dinner">Dinner</option>
                </select>
                <input
                  className="rounded-lg border border-stone-300 px-3 py-2 md:col-span-2"
                  type="text"
                  placeholder="Menu items (comma separated)"
                  required
                  value={mealForm.menu_items}
                  onChange={(e) => setMealForm((prev) => ({ ...prev, menu_items: e.target.value }))}
                />
                <input
                  className="rounded-lg border border-stone-300 px-3 py-2 md:col-span-2"
                  type="datetime-local"
                  required
                  value={mealForm.booking_deadline}
                  onChange={(e) => setMealForm((prev) => ({ ...prev, booking_deadline: e.target.value }))}
                />
                <button className="rounded-lg bg-moss px-4 py-2 text-sm font-semibold text-white">
                  {mealForm.id ? "Update Meal" : "Create Meal"}
                </button>
                {mealForm.id && (
                  <button
                    type="button"
                    onClick={() =>
                      setMealForm({
                        id: "",
                        date: "",
                        type: "breakfast",
                        menu_items: "",
                        booking_deadline: ""
                      })
                    }
                    className="rounded-lg bg-stone-400 px-4 py-2 text-sm font-semibold text-white"
                  >
                    Clear
                  </button>
                )}
              </form>

              <div className="mt-5 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-600">
                      <th className="py-2">Meal</th>
                      <th className="py-2">Total Bookings</th>
                      <th className="py-2">Required Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mealBookingStats.map((row) => (
                      <tr key={row.meal.id} className="border-b border-stone-100">
                        <td className="py-2">{row.meal.type + " - " + row.meal.date}</td>
                        <td className="py-2">{row.totalBookings}</td>
                        <td className="py-2">{row.requiredQuantity.toFixed(1)} portions</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-2xl bg-white p-5 shadow">
              <h2 className="text-xl font-bold">Waste Logs and Analytics</h2>

              <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={saveWasteLog}>
                <select
                  className="rounded-lg border border-stone-300 px-3 py-2"
                  required
                  value={wasteForm.meal_id}
                  onChange={(e) => setWasteForm((prev) => ({ ...prev, meal_id: e.target.value }))}
                >
                  <option value="">Select meal</option>
                  {meals.map((meal) => (
                    <option key={meal.id} value={meal.id}>
                      {meal.type} - {meal.date}
                    </option>
                  ))}
                </select>
                <input
                  className="rounded-lg border border-stone-300 px-3 py-2"
                  type="date"
                  required
                  value={wasteForm.date}
                  onChange={(e) => setWasteForm((prev) => ({ ...prev, date: e.target.value }))}
                />
                <input
                  className="rounded-lg border border-stone-300 px-3 py-2"
                  type="number"
                  min="0"
                  placeholder="Prepared quantity"
                  required
                  value={wasteForm.prepared_quantity}
                  onChange={(e) => setWasteForm((prev) => ({ ...prev, prepared_quantity: e.target.value }))}
                />
                <input
                  className="rounded-lg border border-stone-300 px-3 py-2"
                  type="number"
                  min="0"
                  placeholder="Consumed quantity"
                  required
                  value={wasteForm.consumed_quantity}
                  onChange={(e) => setWasteForm((prev) => ({ ...prev, consumed_quantity: e.target.value }))}
                />
                <button className="rounded-lg bg-coral px-4 py-2 text-sm font-semibold text-white">Save Waste Log</button>
              </form>

              <div className="mt-5 grid gap-5 xl:grid-cols-2">
                <div className="rounded-xl border border-stone-200 p-3">
                  <h3 className="mb-2 text-sm font-bold">Booked vs Prepared</h3>
                  <div className="h-64 w-full">
                    <ResponsiveContainer>
                      <BarChart data={bookedVsPreparedData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="label" hide />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="booked" fill="#2e5e4e" />
                        <Bar dataKey="prepared" fill="#e1a42a" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="rounded-xl border border-stone-200 p-3">
                  <h3 className="mb-2 text-sm font-bold">Waste Trend (%)</h3>
                  <div className="h-64 w-full">
                    <ResponsiveContainer>
                      <LineChart data={wasteTrendData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="wastePercentage" stroke="#f2643d" strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-3">
                <p className="rounded-xl bg-stone-100 p-3 text-sm">
                  <span className="font-semibold">Insight:</span> {wasteInsight}
                </p>
                <p className="rounded-xl bg-stone-100 p-3 text-sm">
                  <span className="font-semibold">Predicted next-meal demand:</span> {prediction} bookings (7-day average)
                </p>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-600">
                      <th className="py-2">Date</th>
                      <th className="py-2">Prepared</th>
                      <th className="py-2">Consumed</th>
                      <th className="py-2">Wasted</th>
                      <th className="py-2">Waste %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wasteLogs.map((log) => {
                      const pct = log.prepared_quantity > 0 ? (log.wasted_quantity / log.prepared_quantity) * 100 : 0;
                      return (
                        <tr
                          key={log.id}
                          className={`border-b border-stone-100 ${pct >= 20 ? "bg-red-50 text-red-700" : ""}`}
                        >
                          <td className="py-2">{log.date}</td>
                          <td className="py-2">{log.prepared_quantity}</td>
                          <td className="py-2">{log.consumed_quantity}</td>
                          <td className="py-2">{log.wasted_quantity}</td>
                          <td className="py-2">{pct.toFixed(2)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>

      {authError && (
        <div className="fixed bottom-4 right-4 max-w-sm rounded-xl bg-red-600 px-4 py-3 text-sm text-white shadow-lg">
          {authError}
        </div>
      )}
    </div>
  );
}
