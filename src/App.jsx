import { useEffect, useMemo, useRef, useState } from "react";
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

function getErrorStatus(error) {
  if (!error || typeof error !== "object") return null;
  if (typeof error.status === "number") return error.status;
  if (typeof error.code === "number") return error.code;
  return null;
}

function formatSupabaseError(error, fallbackMessage = "Something went wrong.") {
  if (!error) return fallbackMessage;
  if (typeof error === "string") return error;

  if (error?.name === "AbortError") {
    return "Request timed out contacting Supabase. This is usually a network/VPN/firewall issue. Try a different network and retry.";
  }

  const status = getErrorStatus(error);
  const message = typeof error.message === "string" ? error.message : "";
  const code = typeof error.code === "string" ? error.code : "";

  if (
    code === "over_email_send_rate_limit" ||
    /over_email_send_rate_limit/i.test(message)
  ) {
    return "Signup is being rate-limited because too many confirmation emails were sent. In Supabase: either disable email confirmation for testing, or configure Custom SMTP (Gmail/SendGrid/etc.), then wait 1-2 minutes and retry.";
  }

  if (status === 429 || /rate limit|too many/i.test(message)) {
    return "Too many requests. Please wait a minute and try again.";
  }

  if (status === 504 || status === 503 || status === 502 || /gateway|timeout/i.test(message)) {
    return "Supabase is taking too long to respond (gateway timeout). Check your internet/DNS and try again.";
  }

  if (/aborted|request timed out/i.test(message)) {
    return "Request timed out contacting Supabase. This is usually a network/VPN/firewall issue. Try a different network and retry.";
  }

  if (/failed to fetch|networkerror|load failed|err_name_not_resolved|could not resolve/i.test(message)) {
    return "Network error contacting Supabase. Check your internet/DNS and try again.";
  }

  return message || fallbackMessage;
}

function isRetryableReadError(error) {
  const status = getErrorStatus(error);
  if (status === 502 || status === 503 || status === 504) return true;
  const message = typeof error?.message === "string" ? error.message : "";
  return /failed to fetch|networkerror|timeout|gateway/i.test(message);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout(promise, ms, timeoutMessage = "Operation timed out") {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function retryRead(fn, { retries = 2, baseDelayMs = 400 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryableReadError(error) || attempt === retries) {
        throw error;
      }
      const delay = baseDelayMs * Math.pow(2, attempt);
      await sleep(delay);
    }
  }
  throw lastError;
}

export default function App() {
  const isAdminAuthPath = window.location.pathname.toLowerCase().startsWith("/admin");
  const forcedAuthRole = isAdminAuthPath ? "admin" : "user";

  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [authLoading, setAuthLoading] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [appLoading, setAppLoading] = useState(true);
  const [authCooldownUntil, setAuthCooldownUntil] = useState(0);

  const [authForm, setAuthForm] = useState({
    name: "",
    email: "",
    password: "",
    adminKind: "hostel"
  });

  const [meals, setMeals] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [wasteLogs, setWasteLogs] = useState([]);

  const [ngos, setNgos] = useState([]);
  const [ngosLoading, setNgosLoading] = useState(false);
  const [ngoForm, setNgoForm] = useState({ name: "", phone: "", email: "", area: "" });

  const [foodNotifications, setFoodNotifications] = useState([]);
  const [foodNotificationsLoading, setFoodNotificationsLoading] = useState(false);
  const [foodNotificationNotice, setFoodNotificationNotice] = useState("");
  const [foodNotificationForm, setFoodNotificationForm] = useState({ remaining_portions: "", area: "", notes: "" });

  const [allUsers, setAllUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);

  const [membershipLoading, setMembershipLoading] = useState(false);
  const [myMembership, setMyMembership] = useState(null);
  const [myHostel, setMyHostel] = useState(null);
  const [joinCode, setJoinCode] = useState("");
  const [creatingHostel, setCreatingHostel] = useState(false);
  const [hostelForm, setHostelForm] = useState({ name: "", kind: "hostel" });

  const membershipLoadSeq = useRef(0);

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
  const authCooldownSeconds = Math.max(0, Math.ceil((authCooldownUntil - Date.now()) / 1000));
  const isAuthCooldown = authCooldownSeconds > 0;

  useEffect(() => {
    if (!profile?.admin_kind) return;
    setHostelForm((prev) => ({ ...prev, kind: profile.admin_kind }));
  }, [profile?.admin_kind]);

  useEffect(() => {
    let alive = true;
    let bootstrapped = false;

    // Never keep the full app behind a spinner for too long.
    const bootstrapTimeoutId = setTimeout(() => {
      if (!alive || bootstrapped) return;
      bootstrapped = true;
      setAppLoading(false);
    }, 4000);

    const initAuth = async () => {
      try {
        const {
          data: { session: activeSession }
        } = await supabase.auth.getSession();

        if (!alive) return;
        setSession(activeSession);
        if (!bootstrapped) {
          bootstrapped = true;
          setAppLoading(false);
        }

        if (activeSession?.user) {
          void loadProfile(activeSession.user.id, activeSession.user);
        } else {
          setProfile(null);
          setAuthError("");
        }
      } catch (error) {
        if (!alive) return;
        setAuthError(formatSupabaseError(error, "Unable to initialize auth."));
        if (!bootstrapped) {
          bootstrapped = true;
          setAppLoading(false);
        }
      }
    };

    initAuth();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!alive) return;
      setSession(newSession);
      try {
        if (newSession?.user) {
          await loadProfile(newSession.user.id, newSession.user);
        } else {
          setProfile(null);
          setAuthError("");
        }
      } catch (error) {
        if (!alive) return;
        setAuthError(formatSupabaseError(error, "Auth state change failed."));
      }
    });

    return () => {
      alive = false;
      clearTimeout(bootstrapTimeoutId);
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session?.user || !profile) {
      return;
    }
    void loadAllData();
    void loadMembership();
    if (profile.role === "admin") {
      void loadNgos();
      void loadFoodNotifications();
    }

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

  function generateJoinCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < 8; i += 1) {
      out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return out;
  }

  async function loadMembership() {
    if (!session?.user) return;
    const seq = (membershipLoadSeq.current += 1);
    setMembershipLoading(true);
    try {
      const { data, error } = await retryRead(
        () =>
          supabase
            .from("hostel_memberships")
            .select("role, created_at, hostels ( id, name, kind, join_code, created_by, created_at )")
            .eq("user_id", session.user.id)
            .order("created_at", { ascending: false })
            .maybeSingle(),
        { retries: 2 }
      );

      if (seq !== membershipLoadSeq.current) return;

      if (error) {
        setAuthError(formatSupabaseError(error, "Failed to load hostel membership."));
        return;
      }

      if (!data) {
        setMyMembership(null);
        setMyHostel(null);
        return;
      }

      setMyMembership({ role: data.role, created_at: data.created_at });
      setMyHostel(data.hostels || null);
      setAuthError("");
    } catch (error) {
      if (seq !== membershipLoadSeq.current) return;
      setAuthError(formatSupabaseError(error, "Failed to load hostel membership."));
    } finally {
      if (seq === membershipLoadSeq.current) {
        setMembershipLoading(false);
      }
    }
  }

  async function handleCreateHostel(e) {
    e.preventDefault();
    if (!isAdmin || !session?.user) return;

    const name = hostelForm.name.trim();
    if (!name) {
      setAuthError("Enter a hostel/hotel/restaurant name.");
      return;
    }

    setCreatingHostel(true);
    setAuthError("");

    try {
      let lastError;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const code = generateJoinCode();
        const kind = profile?.admin_kind || hostelForm.kind;
        const { data, error } = await supabase
          .from("hostels")
          .insert({
            name,
            kind,
            join_code: code,
            created_by: session.user.id
          })
          .select("id, name, kind, join_code, created_by, created_at")
          .single();

        if (!error) {
          // Ensure creator is also a member.
          await supabase.from("hostel_memberships").upsert({
            hostel_id: data.id,
            user_id: session.user.id,
            role: "owner"
          });
          setMyHostel(data);
          setMyMembership({ role: "owner", created_at: new Date().toISOString() });
          setHostelForm({ name: "", kind: hostelForm.kind });
          await loadMembership();
          return;
        }

        lastError = error;
        // Retry if join_code collision.
        if (!/duplicate key|unique constraint/i.test(error.message || "")) {
          break;
        }
      }

      setAuthError(formatSupabaseError(lastError, "Failed to create hostel/hotel/restaurant."));
    } catch (error) {
      setAuthError(formatSupabaseError(error, "Failed to create hostel/hotel/restaurant."));
    } finally {
      setCreatingHostel(false);
    }
  }

  async function handleJoinHostel(e) {
    e.preventDefault();
    if (!session?.user) return;
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      setAuthError("Enter a join code.");
      return;
    }

    setMembershipLoading(true);
    setAuthError("");
    try {
      const { data, error } = await supabase.rpc("join_hostel", { p_join_code: code });
      if (error) {
        setAuthError(formatSupabaseError(error, "Failed to join hostel/hotel/restaurant."));
        return;
      }

      if (data) {
        setMyHostel(data);
      }
      setJoinCode("");
      await loadMembership();
    } catch (error) {
      setAuthError(formatSupabaseError(error, "Failed to join hostel/hotel/restaurant."));
    } finally {
      setMembershipLoading(false);
    }
  }

  async function loadNgos() {
    if (!session?.user || profile?.role !== "admin") return;
    setNgosLoading(true);
    try {
      const { data, error } = await retryRead(
        () => supabase.from("ngos").select("*").order("created_at", { ascending: false }),
        { retries: 2 }
      );

      if (error) {
        setAuthError(formatSupabaseError(error, "Failed to load biodegradable companies."));
        return;
      }

      setNgos(data || []);
    } catch (error) {
      setAuthError(formatSupabaseError(error, "Failed to load biodegradable companies."));
    } finally {
      setNgosLoading(false);
    }
  }

  async function createNgo(e) {
    e.preventDefault();
    if (!session?.user || profile?.role !== "admin") return;

    const name = ngoForm.name.trim();
    if (!name) {
      setAuthError("Enter biodegradable company name.");
      return;
    }

    try {
      const { error } = await supabase.from("ngos").insert({
        name,
        phone: ngoForm.phone.trim() || null,
        email: ngoForm.email.trim() || null,
        area: ngoForm.area.trim() || null,
        created_by: session.user.id
      });

      if (error) {
        setAuthError(formatSupabaseError(error, "Failed to create biodegradable company."));
        return;
      }

      setNgoForm({ name: "", phone: "", email: "", area: "" });
      setAuthError("");
      await loadNgos();
    } catch (error) {
      setAuthError(formatSupabaseError(error, "Failed to create biodegradable company."));
    }
  }

  async function deleteNgo(ngoId) {
    if (!session?.user || profile?.role !== "admin") return;
    try {
      const { error } = await supabase.from("ngos").delete().eq("id", ngoId);
      if (error) {
        setAuthError(formatSupabaseError(error, "Failed to delete biodegradable company."));
        return;
      }
      setAuthError("");
      setNgos((prev) => prev.filter((ngo) => ngo.id !== ngoId));
    } catch (error) {
      setAuthError(formatSupabaseError(error, "Failed to delete biodegradable company."));
    }
  }

  async function loadFoodNotifications() {
    if (!session?.user || profile?.role !== "admin") return;
    setFoodNotificationsLoading(true);
    try {
      const { data, error } = await retryRead(
        () =>
          supabase
            .from("food_remaining_notifications")
            .select(
              "id, remaining_portions, area, notes, created_at, hostels ( id, name, kind ), food_notification_targets(count)"
            )
            .order("created_at", { ascending: false }),
        { retries: 2 }
      );

      if (error) {
        setAuthError(formatSupabaseError(error, "Failed to load food notifications."));
        return;
      }

      setFoodNotifications(data || []);
    } catch (error) {
      setAuthError(formatSupabaseError(error, "Failed to load food notifications."));
    } finally {
      setFoodNotificationsLoading(false);
    }
  }

  async function sendFoodRemainingNotification(e) {
    e.preventDefault();
    if (!session?.user || profile?.role !== "admin") return;

    const remaining = Number(foodNotificationForm.remaining_portions);
    if (!Number.isFinite(remaining) || remaining < 0) {
      setAuthError("Enter a valid remaining food quantity (0 or more).");
      return;
    }

    if (!myHostel?.id) {
      setAuthError("Create or join a hostel/hotel/restaurant first (so the notification has a source)." );
      return;
    }

    setFoodNotificationNotice("");
    setAuthError("");

    try {
      const area = foodNotificationForm.area.trim();
      const notes = foodNotificationForm.notes.trim();

      const { data: created, error: createError } = await supabase
        .from("food_remaining_notifications")
        .insert({
          hostel_id: myHostel.id,
          created_by: session.user.id,
          remaining_portions: remaining,
          area: area || null,
          notes: notes || null
        })
        .select("id")
        .single();

      if (createError) {
        setAuthError(formatSupabaseError(createError, "Failed to send notification."));
        return;
      }

      let ngoQuery = supabase.from("ngos").select("id");
      if (area) {
        ngoQuery = ngoQuery.ilike("area", `%${area}%`);
      }

      const { data: targetNgos, error: targetError } = await ngoQuery;
      if (targetError) {
        setAuthError(
          formatSupabaseError(targetError, "Notification created, but biodegradable companies could not be loaded.")
        );
        await loadFoodNotifications();
        return;
      }

      const targets = (targetNgos || []).map((ngo) => ({
        notification_id: created.id,
        ngo_id: ngo.id
      }));

      if (targets.length) {
        const { error: targetInsertError } = await supabase.from("food_notification_targets").insert(targets);
        if (targetInsertError) {
          setAuthError(
            formatSupabaseError(
              targetInsertError,
              "Notification created, but could not create biodegradable company targets."
            )
          );
          await loadFoodNotifications();
          return;
        }
      }

      setFoodNotificationForm({ remaining_portions: "", area: "", notes: "" });
      setFoodNotificationNotice(
        `Notification sent. Matched ${targets.length} biodegradable compan${targets.length === 1 ? "y" : "ies"}${area ? ` near \"${area}\"` : ""}.`
      );

      await loadFoodNotifications();
    } catch (error) {
      setAuthError(formatSupabaseError(error, "Failed to send notification."));
    }
  }

  useEffect(() => {
    if (!isAdmin || !session?.user) return;
    void loadUsers();
  }, [isAdmin, session?.user]);

  async function loadUsers() {
    if (!session?.user || !isAdmin) return;
    setUsersLoading(true);
    try {
      const { data, error } = await retryRead(
        () => supabase.from("users").select("id,name,role,created_at").order("created_at", { ascending: false }),
        { retries: 2 }
      );

      if (error) {
        setAuthError(formatSupabaseError(error, "Failed to load users."));
        return;
      }

      setAllUsers(data || []);
      setAuthError("");
    } catch (error) {
      setAuthError(formatSupabaseError(error, "Failed to load users."));
    } finally {
      setUsersLoading(false);
    }
  }

  async function loadProfile(userId, authUser = null) {
    try {
      const { data, error } = await retryRead(
        () => supabase.from("users").select("*").eq("id", userId).maybeSingle(),
        { retries: 2 }
      );

      if (error) {
        const status = getErrorStatus(error);
        if (status === 401) {
          setAuthError("Session expired or unauthorized. Please login again.");
          await supabase.auth.signOut();
          setSession(null);
          setProfile(null);
          return;
        }
        setAuthError(formatSupabaseError(error, "Failed to load profile."));
        return;
      }

      if (data) {
        setProfile(data);
        setAuthError("");
        return;
      }

      // Profile row is missing (common when signup/profile insert failed or the DB wasn't initialized).
      let effectiveUser = authUser;
      if (!effectiveUser) {
        const {
          data: { session: activeSession }
        } = await supabase.auth.getSession();
        effectiveUser = activeSession?.user || null;
      }

      const email = effectiveUser?.email || "";
      const metadata = effectiveUser?.user_metadata || {};
      const derivedName = (metadata.name || email.split("@")[0] || "user").trim() || "user";
      const derivedRole = metadata.role === "admin" ? "admin" : "user";
      const derivedAdminKind = derivedRole === "admin" ? metadata.admin_kind || metadata.adminKind : null;

      const { error: insertError } = await supabase.from("users").insert({
        id: userId,
        name: derivedName,
        role: derivedRole,
        admin_kind: derivedAdminKind
      });

      if (insertError) {
        setAuthError(
          formatSupabaseError(
            insertError,
            "Your profile is not set up in the database. Run the SQL schema and try again."
          )
        );
        return;
      }

      const { data: createdProfile, error: createdError } = await supabase
        .from("users")
        .select("*")
        .eq("id", userId)
        .maybeSingle();

      if (createdError) {
        setAuthError(formatSupabaseError(createdError, "Profile created, but could not be loaded."));
        return;
      }

      setProfile(createdProfile);
      setAuthError("");
    } catch (error) {
      setAuthError(formatSupabaseError(error, "Failed to load profile."));
    }
  }

  async function loadAllData() {
    setAppLoading(true);
    try {
      const mealsQuery = () => supabase.from("meals").select("*").order("date", { ascending: true });

      const bookingsQuery = () =>
        isAdmin
          ? supabase.from("bookings").select("*")
          : supabase.from("bookings").select("*").eq("user_id", session.user.id);

      const wasteQuery = () =>
        isAdmin
          ? supabase.from("waste_logs").select("*").order("date", { ascending: true })
          : supabase.from("waste_logs").select("*").order("date", { ascending: true });

      const [{ data: mealsData, error: mealsError }, { data: bookingsData, error: bookingsError }, { data: wasteData, error: wasteError }] =
        await retryRead(() => Promise.all([mealsQuery(), bookingsQuery(), wasteQuery()]), { retries: 2 });

      if (mealsError || bookingsError || wasteError) {
        setAuthError(
          formatSupabaseError(mealsError || bookingsError || wasteError, "Failed to load dashboard data.")
        );
        setAppLoading(false);
        return;
      }

      setMeals(mealsData || []);
      setBookings(bookingsData || []);
      setWasteLogs(wasteData || []);
      setAuthError("");
    } catch (error) {
      setAuthError(formatSupabaseError(error, "Failed to load dashboard data."));
    } finally {
      setAppLoading(false);
    }
  }

  async function handleSignup(e) {
    e.preventDefault();
    if (authLoading || isAuthCooldown) return;
    setAuthLoading(true);
    setAuthError("");

    try {
      const name = authForm.name?.trim() || "";
      const adminKind = forcedAuthRole === "admin" ? authForm.adminKind : null;

      const doSignup = async () =>
        await supabase.auth.signUp({
          email: authForm.email,
          password: authForm.password,
          options: {
            data: {
              name,
              role: forcedAuthRole,
              admin_kind: adminKind
            }
          }
        });

      let { data, error } = await doSignup();

      const firstStatus = getErrorStatus(error);
      if (error && (firstStatus === 502 || firstStatus === 503 || firstStatus === 504)) {
        await sleep(800);
        ({ data, error } = await doSignup());
      }

      if (error) {
        const status = getErrorStatus(error);
        if (status === 429) {
          setAuthCooldownUntil(Date.now() + 60_000);
        }
        const message = formatSupabaseError(error, "Signup failed.");
        if (status === 502 || status === 503 || status === 504) {
          setAuthError(`${message} If you already clicked once, the account might have been created—try Login.`);
        } else {
          setAuthError(message);
        }
        setAuthLoading(false);
        return;
      }

      // If email confirmation is enabled, Supabase may return `user` without a session.
      // In that case, PostgREST requests will be anonymous and inserts will fail (401/RLS).
      if (!data.session) {
        setAuthError(
          "Account created. Check your email to confirm, then login. Your profile will be created automatically on first login."
        );
        setAuthLoading(false);
        setAuthMode("login");
        return;
      }

      if (data.user) {
        const fallbackName = data.user.email ? data.user.email.split("@")[0] : "user";
        const resolvedName = name || fallbackName;

        const { error: profileError } = await supabase.from("users").insert({
          id: data.user.id,
          name: resolvedName,
          role: forcedAuthRole,
          admin_kind: adminKind
        });

        if (profileError) {
          setAuthError(formatSupabaseError(profileError, "Profile creation failed."));
        }
      }
    } catch (error) {
      setAuthError(formatSupabaseError(error, "Signup failed."));
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    if (authLoading || isAuthCooldown) return;
    setAuthLoading(true);
    setAuthError("");

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: authForm.email,
        password: authForm.password
      });

      if (error) {
        const status = getErrorStatus(error);
        if (status === 429) {
          setAuthCooldownUntil(Date.now() + 60_000);
        }
        setAuthError(formatSupabaseError(error, "Login failed."));
        setAuthLoading(false);
        return;
      }

      if (data?.user?.id) {
        const { data: profileRow } = await supabase
          .from("users")
          .select("role")
          .eq("id", data.user.id)
          .maybeSingle();

        const metadataRole = data.user.user_metadata?.role === "admin" ? "admin" : "user";
        const effectiveRole = profileRow?.role || metadataRole;

        if (isAdminAuthPath && effectiveRole !== "admin") {
          await supabase.auth.signOut();
          setSession(null);
          setProfile(null);
          setAuthError("This account is not an admin. Use an admin account at /admin.");
          return;
        }

        if (!isAdminAuthPath && effectiveRole !== "user") {
          await supabase.auth.signOut();
          setSession(null);
          setProfile(null);
          setAuthError("Only user accounts can login here. Admins should login at /admin.");
          return;
        }
      }
    } catch (error) {
      setAuthError(formatSupabaseError(error, "Login failed."));
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    if (logoutLoading) return;
    setLogoutLoading(true);
    try {
      await supabase.auth.signOut();
    } catch {
      // Always clear local state even if network signOut fails.
    } finally {
      setSession(null);
      setProfile(null);
      setBookings([]);
      setMeals([]);
      setWasteLogs([]);
      setAllUsers([]);
      setMyMembership(null);
      setMyHostel(null);
      setLogoutLoading(false);
    }
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

    try {
      const { data: existing, error: existingError } = await supabase
        .from("bookings")
        .select("id")
        .eq("user_id", session.user.id)
        .eq("meal_id", mealId)
        .eq("status", "confirmed")
        .maybeSingle();

      if (existingError) {
        setAuthError(formatSupabaseError(existingError, "Failed to check existing bookings."));
        return;
      }

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
        setAuthError(formatSupabaseError(error, "Booking failed."));
        return;
      }

      setAuthError("");
      await loadAllData();
    } catch (error) {
      setAuthError(formatSupabaseError(error, "Booking failed."));
    }
  }

  async function handleCancelBooking(bookingId) {
    try {
      const { error } = await supabase.from("bookings").update({ status: "cancelled" }).eq("id", bookingId);
      if (error) {
        setAuthError(formatSupabaseError(error, "Cancellation failed."));
        return;
      }
      await loadAllData();
    } catch (error) {
      setAuthError(formatSupabaseError(error, "Cancellation failed."));
    }
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

    try {
      const { error } = await query;
      if (error) {
        setAuthError(formatSupabaseError(error, "Failed to save meal."));
        return;
      }
    } catch (error) {
      setAuthError(formatSupabaseError(error, "Failed to save meal."));
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
    try {
      const { error } = await supabase.from("meals").delete().eq("id", mealId);
      if (error) {
        setAuthError(formatSupabaseError(error, "Failed to delete meal."));
        return;
      }
      await loadAllData();
    } catch (error) {
      setAuthError(formatSupabaseError(error, "Failed to delete meal."));
    }
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

    try {
      const { data: existing, error: existingError } = await supabase
        .from("waste_logs")
        .select("id")
        .eq("meal_id", wasteForm.meal_id)
        .eq("date", wasteForm.date)
        .maybeSingle();

      if (existingError) {
        setAuthError(formatSupabaseError(existingError, "Failed to check existing waste log."));
        return;
      }

      const query = existing
        ? supabase.from("waste_logs").update(payload).eq("id", existing.id)
        : supabase.from("waste_logs").insert(payload);

      const { error } = await query;
      if (error) {
        setAuthError(formatSupabaseError(error, "Failed to save waste log."));
        return;
      }

      setWasteForm({ meal_id: "", prepared_quantity: "", consumed_quantity: "", date: "" });
      await loadAllData();
    } catch (error) {
      setAuthError(formatSupabaseError(error, "Failed to save waste log."));
    }
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
            <p className="mb-3 text-base font-bold">{isAdminAuthPath ? "Admin Login" : "User Login"}</p>

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

              {isAdminAuthPath && authMode === "signup" && (
                <select
                  className="rounded-xl border border-stone-300 px-3 py-2"
                  value={authForm.adminKind}
                  onChange={(e) => setAuthForm((prev) => ({ ...prev, adminKind: e.target.value }))}
                >
                  <option value="hostel">Admin (Hostel)</option>
                  <option value="hotel">Admin (Hotel)</option>
                  <option value="restaurant">Admin (Restaurant)</option>
                </select>
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

              <button
                className="rounded-xl bg-coral px-4 py-2 font-semibold text-white disabled:opacity-70"
                disabled={authLoading || isAuthCooldown}
              >
                {authLoading
                  ? "Please wait..."
                  : isAuthCooldown
                    ? `Try again in ${authCooldownSeconds}s`
                    : authMode === "signup"
                      ? "Create account"
                      : "Login"}
              </button>

              {!isAdminAuthPath && authMode === "login" && (
                <p className="text-sm text-stone-600">
                  Admin account? Login from <a className="font-semibold text-moss underline" href="/admin">/admin</a>.
                </p>
              )}

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
        <button
          onClick={handleLogout}
          disabled={logoutLoading}
          className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-70"
        >
          {logoutLoading ? "Logging out..." : "Logout"}
        </button>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-2">
        <section className="rounded-2xl bg-white p-5 shadow lg:col-span-2">
          <h2 className="text-xl font-bold">Hostel / Hotel / Restaurant</h2>

          {membershipLoading ? (
            <p className="mt-2 text-sm text-stone-600">Loading membership...</p>
          ) : myHostel ? (
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <div className="rounded-xl border border-stone-200 p-4">
                <p className="text-sm text-stone-600">You are part of</p>
                <p className="mt-1 text-lg font-semibold">{myHostel.name}</p>
                <p className="mt-1 text-xs text-stone-500">
                  Type: {myHostel.kind} | Your role: {myMembership?.role || "member"}
                </p>
              </div>

              {isAdmin && myHostel.join_code && (
                <div className="rounded-xl border border-stone-200 p-4">
                  <p className="text-sm text-stone-600">Share this join code</p>
                  <p className="mt-1 font-mono text-lg font-semibold tracking-wider">{myHostel.join_code}</p>
                  <p className="mt-1 text-xs text-stone-500">Users can join using this code.</p>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-2 text-sm text-stone-600">You haven't joined any hostel/hotel yet.</p>
          )}

          {!isAdmin && !myHostel && (
            <form className="mt-4 flex flex-col gap-2 md:flex-row" onSubmit={handleJoinHostel}>
              <input
                className="flex-1 rounded-lg border border-stone-300 px-3 py-2"
                placeholder="Enter join code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
              />
              <button
                className="rounded-lg bg-coral px-4 py-2 text-sm font-semibold text-white disabled:opacity-70"
                disabled={membershipLoading}
              >
                {membershipLoading ? "Joining..." : "Join"}
              </button>
            </form>
          )}

          {isAdmin && !myHostel && (
            <form className="mt-4 grid gap-2 md:grid-cols-3" onSubmit={handleCreateHostel}>
              <input
                className="rounded-lg border border-stone-300 px-3 py-2 md:col-span-2"
                placeholder="Hostel/Hotel/Restaurant name"
                value={hostelForm.name}
                onChange={(e) => setHostelForm((prev) => ({ ...prev, name: e.target.value }))}
              />
              <select
                className="rounded-lg border border-stone-300 px-3 py-2"
                value={hostelForm.kind}
                onChange={(e) => setHostelForm((prev) => ({ ...prev, kind: e.target.value }))}
                disabled={Boolean(profile?.admin_kind)}
              >
                <option value="hostel">Hostel</option>
                <option value="hotel">Hotel</option>
                <option value="restaurant">Restaurant</option>
              </select>
              <button
                className="rounded-lg bg-moss px-4 py-2 text-sm font-semibold text-white disabled:opacity-70 md:col-span-3"
                disabled={creatingHostel}
              >
                {creatingHostel ? "Creating..." : "Create"}
              </button>
            </form>
          )}
        </section>
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

            <section className="rounded-2xl bg-white p-5 shadow lg:col-span-2">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <h2 className="text-xl font-bold">Biodegradable Companies & Food Wastage Notifications</h2>
                <button
                  type="button"
                  onClick={() => {
                    void loadNgos();
                    void loadFoodNotifications();
                  }}
                  className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-70"
                  disabled={ngosLoading || foodNotificationsLoading}
                >
                  {ngosLoading || foodNotificationsLoading ? "Refreshing..." : "Refresh"}
                </button>
              </div>

              <div className="mt-4 grid gap-6 lg:grid-cols-2">
                <div className="rounded-xl border border-stone-200 p-4">
                  <h3 className="text-sm font-bold">Add Biodegradable Company (Admin only)</h3>
                  <form className="mt-3 grid gap-2" onSubmit={createNgo}>
                    <input
                      className="rounded-lg border border-stone-300 px-3 py-2"
                      placeholder="Company name"
                      value={ngoForm.name}
                      onChange={(e) => setNgoForm((prev) => ({ ...prev, name: e.target.value }))}
                      required
                    />
                    <input
                      className="rounded-lg border border-stone-300 px-3 py-2"
                      placeholder="Service area / locality (for nearby matching)"
                      value={ngoForm.area}
                      onChange={(e) => setNgoForm((prev) => ({ ...prev, area: e.target.value }))}
                    />
                    <div className="grid gap-2 md:grid-cols-2">
                      <input
                        className="rounded-lg border border-stone-300 px-3 py-2"
                        placeholder="Phone (optional)"
                        value={ngoForm.phone}
                        onChange={(e) => setNgoForm((prev) => ({ ...prev, phone: e.target.value }))}
                      />
                      <input
                        className="rounded-lg border border-stone-300 px-3 py-2"
                        type="email"
                        placeholder="Email (optional)"
                        value={ngoForm.email}
                        onChange={(e) => setNgoForm((prev) => ({ ...prev, email: e.target.value }))}
                      />
                    </div>
                    <button className="rounded-lg bg-moss px-4 py-2 text-sm font-semibold text-white">Add Company</button>
                  </form>

                  <div className="mt-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold">Biodegradable Companies</h4>
                      {ngosLoading && <span className="text-xs text-stone-500">Loading...</span>}
                    </div>
                    <div className="mt-2 space-y-2">
                      {ngos.map((ngo) => (
                        <div key={ngo.id} className="flex items-start justify-between gap-3 rounded-lg bg-stone-50 p-3">
                          <div>
                            <div className="text-sm font-semibold">{ngo.name}</div>
                            <div className="text-xs text-stone-600">
                              {ngo.area ? `Service area: ${ngo.area}` : "Service area: -"}
                              {ngo.phone ? ` | Phone: ${ngo.phone}` : ""}
                              {ngo.email ? ` | Email: ${ngo.email}` : ""}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white"
                            onClick={() => deleteNgo(ngo.id)}
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                      {!ngosLoading && !ngos.length && (
                        <p className="text-sm text-stone-500">No biodegradable companies added yet.</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-stone-200 p-4">
                  <h3 className="text-sm font-bold">Send Food Wastage Conversion Notification</h3>
                  <p className="mt-1 text-xs text-stone-600">
                    Sends an in-app notification to biodegradable companies that use food wastage to produce
                    pesticides and fertilizers. Leave area blank to notify all companies.
                  </p>

                  <form className="mt-3 grid gap-2" onSubmit={sendFoodRemainingNotification}>
                    <input
                      className="rounded-lg border border-stone-300 px-3 py-2"
                      type="number"
                      min="0"
                      step="1"
                      placeholder="Remaining food (portions)"
                      value={foodNotificationForm.remaining_portions}
                      onChange={(e) =>
                        setFoodNotificationForm((prev) => ({ ...prev, remaining_portions: e.target.value }))
                      }
                      required
                    />
                    <input
                      className="rounded-lg border border-stone-300 px-3 py-2"
                      placeholder='Area / locality (e.g. "Andheri" or "Sector 5") for nearby companies'
                      value={foodNotificationForm.area}
                      onChange={(e) => setFoodNotificationForm((prev) => ({ ...prev, area: e.target.value }))}
                    />
                    <textarea
                      className="min-h-24 rounded-lg border border-stone-300 px-3 py-2"
                      placeholder="Notes (optional: food type, pickup window, moisture level, etc.)"
                      value={foodNotificationForm.notes}
                      onChange={(e) => setFoodNotificationForm((prev) => ({ ...prev, notes: e.target.value }))}
                    />
                    <button className="rounded-lg bg-coral px-4 py-2 text-sm font-semibold text-white">
                      Send to Companies
                    </button>
                    {foodNotificationNotice && <p className="text-xs text-moss">{foodNotificationNotice}</p>}
                  </form>

                  <div className="mt-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold">Sent Notifications</h4>
                      {foodNotificationsLoading && <span className="text-xs text-stone-500">Loading...</span>}
                    </div>

                    <div className="mt-2 space-y-2">
                      {foodNotifications.map((n) => {
                        const targetCount = Array.isArray(n.food_notification_targets)
                          ? n.food_notification_targets[0]?.count || 0
                          : 0;

                        return (
                          <div key={n.id} className="rounded-lg bg-stone-50 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-sm font-semibold">
                                {n.hostels?.name ? `${n.hostels.name} (${n.hostels.kind})` : "Source"} → {targetCount}
                                {" "}
                                compan{targetCount === 1 ? "y" : "ies"}
                              </div>
                              <div className="text-xs text-stone-600">{n.created_at ? formatDateTime(n.created_at) : ""}</div>
                            </div>
                            <div className="mt-1 text-xs text-stone-700">
                              Available food wastage: <span className="font-semibold">{n.remaining_portions}</span>
                              {" "}
                              portions
                              {n.area ? ` | Area: ${n.area}` : ""}
                            </div>
                            {n.notes && <div className="mt-1 text-xs text-stone-600">{n.notes}</div>}
                          </div>
                        );
                      })}
                      {!foodNotificationsLoading && !foodNotifications.length && (
                        <p className="text-sm text-stone-500">No notifications sent yet.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl bg-white p-5 shadow">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <h2 className="text-xl font-bold">User Management</h2>
                <button
                  type="button"
                  onClick={loadUsers}
                  className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-70"
                  disabled={usersLoading}
                >
                  {usersLoading ? "Refreshing..." : "Refresh users"}
                </button>
              </div>

              <p className="mt-2 text-sm text-stone-600">
                User roles are fixed. Role changes are disabled in the app.
              </p>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-600">
                      <th className="py-2">Name</th>
                      <th className="py-2">Role</th>
                      <th className="py-2">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allUsers.map((user) => {
                      const isSelf = user.id === session?.user?.id;

                      return (
                        <tr key={user.id} className="border-b border-stone-100">
                          <td className="py-2">
                            <div className="font-semibold">{user.name}</div>
                            {isSelf && <div className="text-xs text-stone-500">This is you</div>}
                          </td>
                          <td className="py-2">{user.role}</td>
                          <td className="py-2 text-stone-600">{user.created_at ? new Date(user.created_at).toLocaleString() : "-"}</td>
                        </tr>
                      );
                    })}

                    {!usersLoading && !allUsers.length && (
                      <tr>
                        <td className="py-3 text-stone-500" colSpan={3}>
                          No users found (or you don’t have permission to list users).
                        </td>
                      </tr>
                    )}
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
