// ---------------------------
// Data Management (localStorage)
// ---------------------------
const STORAGE_KEYS = {
    USERS: 'meal_prebook_users',
    MEALS: 'meal_prebook_meals',
    BOOKINGS: 'meal_prebook_bookings',
    WASTE_LOGS: 'meal_prebook_waste_logs',
    CURRENT_USER: 'meal_prebook_current_user'
};

// Initialize default data
function initData() {
    if (!localStorage.getItem(STORAGE_KEYS.USERS)) {
        const defaultUsers = [
            { id: '1', name: 'Admin User', email: 'admin@example.com', password: 'admin123', role: 'admin' },
            { id: '2', name: 'Regular User', email: 'user@example.com', password: 'user123', role: 'user' }
        ];
        localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(defaultUsers));
    }
    if (!localStorage.getItem(STORAGE_KEYS.MEALS)) {
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const defaultMeals = [
            {
                id: 'm1',
                date: today.toISOString().split('T')[0],
                type: 'lunch',
                menuItems: 'Grilled Chicken, Rice, Veggies',
                bookingDeadline: new Date(today.setHours(10,0,0,0)).toISOString()
            },
            {
                id: 'm2',
                date: tomorrow.toISOString().split('T')[0],
                type: 'breakfast',
                menuItems: 'Pancakes, Eggs, Fruit',
                bookingDeadline: new Date(tomorrow.setHours(8,0,0,0)).toISOString()
            }
        ];
        localStorage.setItem(STORAGE_KEYS.MEALS, JSON.stringify(defaultMeals));
    }
    if (!localStorage.getItem(STORAGE_KEYS.BOOKINGS)) {
        localStorage.setItem(STORAGE_KEYS.BOOKINGS, JSON.stringify([]));
    }
    if (!localStorage.getItem(STORAGE_KEYS.WASTE_LOGS)) {
        localStorage.setItem(STORAGE_KEYS.WASTE_LOGS, JSON.stringify([]));
    }
}

function getUsers() { return JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS)); }
function getMeals() { return JSON.parse(localStorage.getItem(STORAGE_KEYS.MEALS)); }
function getBookings() { return JSON.parse(localStorage.getItem(STORAGE_KEYS.BOOKINGS)); }
function getWasteLogs() { return JSON.parse(localStorage.getItem(STORAGE_KEYS.WASTE_LOGS)); }
function saveMeals(meals) { localStorage.setItem(STORAGE_KEYS.MEALS, JSON.stringify(meals)); }
function saveBookings(bookings) { localStorage.setItem(STORAGE_KEYS.BOOKINGS, JSON.stringify(bookings)); }
function saveWasteLogs(logs) { localStorage.setItem(STORAGE_KEYS.WASTE_LOGS, JSON.stringify(logs)); }
function saveUsers(users) { localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users)); }

// ---------------------------
// Current User
// ---------------------------
let currentUser = null;

function setCurrentUser(user) {
    currentUser = user;
    if (user) {
        localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify({ id: user.id, role: user.role }));
    } else {
        localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
    }
}

function loadCurrentUser() {
    const stored = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
    if (stored) {
        const { id } = JSON.parse(stored);
        const users = getUsers();
        currentUser = users.find(u => u.id === id);
    }
    return currentUser;
}

// ---------------------------
// Helper Functions
// ---------------------------
function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString();
}
function formatDateTime(dateTimeStr) {
    return new Date(dateTimeStr).toLocaleString();
}
function isDeadlinePassed(deadlineStr) {
    return new Date(deadlineStr) < new Date();
}

// ---------------------------
// UI Rendering
// ---------------------------
function renderUserDashboard() {
    const meals = getMeals();
    const bookings = getBookings().filter(b => b.userId === currentUser.id);
    const container = document.getElementById('userMealsContainer');
    const historyContainer = document.getElementById('bookingHistoryContainer');

    // Show meals
    container.innerHTML = meals.map(meal => `
        <div class="meal-card" data-meal-id="${meal.id}">
            <h4>${meal.type.toUpperCase()} - ${formatDate(meal.date)}</h4>
            <div class="menu">🍽️ ${meal.menuItems}</div>
            <div class="deadline">⏰ Book by: ${formatDateTime(meal.bookingDeadline)}</div>
            <div class="portion-buttons" data-meal-id="${meal.id}">
                <button class="portion-btn" data-size="small">Small</button>
                <button class="portion-btn" data-size="medium">Medium</button>
                <button class="portion-btn" data-size="large">Large</button>
            </div>
            <button class="btn btn-primary book-btn" data-meal-id="${meal.id}" ${isDeadlinePassed(meal.bookingDeadline) ? 'disabled' : ''}>
                ${isDeadlinePassed(meal.bookingDeadline) ? 'Deadline Passed' : 'Book Now'}
            </button>
        </div>
    `).join('');

    // Attach event listeners for portion selection and booking
    document.querySelectorAll('.portion-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const mealCard = btn.closest('.meal-card');
            mealCard.querySelectorAll('.portion-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
        });
    });
    document.querySelectorAll('.book-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const mealId = btn.dataset.mealId;
            const mealCard = document.querySelector(`.meal-card[data-meal-id="${mealId}"]`);
            const selectedPortion = mealCard.querySelector('.portion-btn.selected');
            if (!selectedPortion) {
                alert('Please select a portion size.');
                return;
            }
            const portionSize = selectedPortion.dataset.size;
            const existingBooking = getBookings().find(b => b.userId === currentUser.id && b.mealId === mealId);
            if (existingBooking) {
                alert('You have already booked this meal.');
                return;
            }
            const newBooking = {
                id: Date.now().toString(),
                userId: currentUser.id,
                mealId: mealId,
                portionSize: portionSize,
                status: 'confirmed',
                createdAt: new Date().toISOString()
            };
            const bookings = getBookings();
            bookings.push(newBooking);
            saveBookings(bookings);
            renderUserDashboard(); // refresh to show updated booking state (button disabled)
            renderAdminDashboard(); // also update admin view if logged in as admin
        });
    });

    // Booking history
    const history = bookings.map(booking => {
        const meal = getMeals().find(m => m.id === booking.mealId);
        return `
            <div class="history-item">
                <span>${meal ? meal.type + ' on ' + formatDate(meal.date) : 'Deleted meal'}</span>
                <span>${booking.portionSize} portion</span>
                <span>${new Date(booking.createdAt).toLocaleDateString()}</span>
            </div>
        `;
    }).join('');
    historyContainer.innerHTML = history || '<p>No bookings yet.</p>';
}

function renderAdminDashboard() {
    const meals = getMeals();
    const bookings = getBookings();
    const wasteLogs = getWasteLogs();

    // Meals management
    const adminMealsContainer = document.getElementById('adminMealsContainer');
    adminMealsContainer.innerHTML = meals.map(meal => {
        const mealBookings = bookings.filter(b => b.mealId === meal.id);
        const totalBookings = mealBookings.length;
        return `
            <div class="meal-card">
                <h4>${meal.type.toUpperCase()} - ${formatDate(meal.date)}</h4>
                <div class="menu">${meal.menuItems}</div>
                <div>📅 Deadline: ${formatDateTime(meal.bookingDeadline)}</div>
                <div>📊 Bookings: ${totalBookings}</div>
                <div style="margin-top: 0.5rem;">
                    <button class="btn btn-secondary edit-meal" data-id="${meal.id}">Edit</button>
                    <button class="btn btn-danger delete-meal" data-id="${meal.id}">Delete</button>
                </div>
            </div>
        `;
    }).join('');

    document.querySelectorAll('.edit-meal').forEach(btn => {
        btn.addEventListener('click', () => openMealModal(btn.dataset.id));
    });
    document.querySelectorAll('.delete-meal').forEach(btn => {
        btn.addEventListener('click', () => {
            if (confirm('Delete this meal? All bookings will also be removed.')) {
                const id = btn.dataset.id;
                const updatedMeals = meals.filter(m => m.id !== id);
                const updatedBookings = bookings.filter(b => b.mealId !== id);
                saveMeals(updatedMeals);
                saveBookings(updatedBookings);
                renderAdminDashboard();
                if (currentUser.role === 'user') renderUserDashboard();
            }
        });
    });

    // Waste logging form
    const wasteFormContainer = document.getElementById('wasteLogFormContainer');
    wasteFormContainer.innerHTML = `
        <button id="logWasteBtn" class="btn btn-secondary">+ Log Waste for a Meal</button>
    `;
    document.getElementById('logWasteBtn')?.addEventListener('click', () => openWasteModal());

    // Waste logs table
    const wasteTableContainer = document.getElementById('wasteLogsTable');
    if (wasteLogs.length === 0) {
        wasteTableContainer.innerHTML = '<p>No waste logs yet.</p>';
    } else {
        const table = `
            <table>
                <thead><tr><th>Meal</th><th>Date</th><th>Prepared</th><th>Consumed</th><th>Wasted</th><th>Waste %</th></tr></thead>
                <tbody>
                    ${wasteLogs.map(log => {
                        const meal = meals.find(m => m.id === log.mealId);
                        const wastePercent = ((log.wastedQuantity / log.preparedQuantity) * 100).toFixed(1);
                        const isHigh = wastePercent > 20;
                        return `
                            <tr class="${isHigh ? 'high-waste' : ''}">
                                <td>${meal ? meal.type : 'Deleted'}</td>
                                <td>${formatDate(log.date)}</td>
                                <td>${log.preparedQuantity}</td>
                                <td>${log.consumedQuantity}</td>
                                <td>${log.wastedQuantity}</td>
                                <td>${wastePercent}%</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;
        wasteTableContainer.innerHTML = table;
    }

    // Update charts and insights
    updateAnalytics(meals, bookings, wasteLogs);
}

function updateAnalytics(meals, bookings, wasteLogs) {
    // Chart 1: Booked vs Prepared (aggregated over last 7 days or overall)
    // For simplicity, we compare total bookings vs total prepared quantities from waste logs
    const totalBookings = bookings.length;
    const totalPrepared = wasteLogs.reduce((sum, log) => sum + log.preparedQuantity, 0);
    const ctx1 = document.getElementById('bookedVsPreparedChart')?.getContext('2d');
    if (ctx1) {
        if (window.bookedChart) window.bookedChart.destroy();
        window.bookedChart = new Chart(ctx1, {
            type: 'bar',
            data: {
                labels: ['Booked Meals', 'Prepared Portions'],
                datasets: [{
                    label: 'Count',
                    data: [totalBookings, totalPrepared],
                    backgroundColor: ['#3b82f6', '#10b981']
                }]
            },
            options: { responsive: true, maintainAspectRatio: true }
        });
    }

    // Chart 2: Waste trends over time (last 7 days)
    const last7Days = [...Array(7)].map((_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - i);
        return d.toISOString().split('T')[0];
    }).reverse();
    const wastePercentages = last7Days.map(date => {
        const logsOnDate = wasteLogs.filter(log => log.date === date);
        if (logsOnDate.length === 0) return 0;
        const totalWasted = logsOnDate.reduce((sum, l) => sum + l.wastedQuantity, 0);
        const totalPrepared = logsOnDate.reduce((sum, l) => sum + l.preparedQuantity, 0);
        return totalPrepared ? (totalWasted / totalPrepared) * 100 : 0;
    });
    const ctx2 = document.getElementById('wasteTrendsChart')?.getContext('2d');
    if (ctx2) {
        if (window.wasteTrendChart) window.wasteTrendChart.destroy();
        window.wasteTrendChart = new Chart(ctx2, {
            type: 'line',
            data: {
                labels: last7Days.map(d => formatDate(d)),
                datasets: [{
                    label: 'Waste Percentage (%)',
                    data: wastePercentages,
                    borderColor: '#ef4444',
                    tension: 0.2
                }]
            },
            options: { responsive: true, maintainAspectRatio: true }
        });
    }

    // Insights
    const avgWaste = wastePercentages.reduce((a,b) => a+b,0) / wastePercentages.length;
    const insightsDiv = document.getElementById('insights');
    insightsDiv.innerHTML = `
        <strong>💡 Insights:</strong><br>
        ${avgWaste > 20 ? '🔴 High waste detected! Consider reducing preparation.' : '✅ Waste levels are manageable.'}
        ${avgWaste > 30 ? '<br>⚠️ Extreme waste! Review portion sizes.' : ''}
    `;

    // Simple prediction: based on last 3 days average bookings
    const recentBookingsCount = getRecentBookingsCount(7);
    const predictedPortions = Math.ceil(recentBookingsCount * 1.1); // 10% buffer
    const predictionDiv = document.getElementById('prediction');
    predictionDiv.innerHTML = `
        <strong>🔮 Smart Prediction:</strong><br>
        Based on last 7 days, suggested preparation for next meal: <strong>${predictedPortions} portions</strong> (approx. ${recentBookingsCount} bookings + 10% safety).
    `;
}

function getRecentBookingsCount(days) {
    const bookings = getBookings();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const recent = bookings.filter(b => new Date(b.createdAt) >= cutoff);
    return recent.length;
}

// ---------------------------
// Meal Modal (Add/Edit)
// ---------------------------
function openMealModal(mealId = null) {
    const modal = document.getElementById('mealModal');
    const title = document.getElementById('modalTitle');
    const form = document.getElementById('mealForm');
    form.reset();
    document.getElementById('mealId').value = '';

    if (mealId) {
        title.innerText = 'Edit Meal';
        const meal = getMeals().find(m => m.id === mealId);
        if (meal) {
            document.getElementById('mealId').value = meal.id;
            document.getElementById('mealDate').value = meal.date;
            document.getElementById('mealType').value = meal.type;
            document.getElementById('mealMenu').value = meal.menuItems;
            document.getElementById('mealDeadline').value = meal.bookingDeadline.slice(0, 16);
        }
    } else {
        title.innerText = 'Add New Meal';
    }
    modal.style.display = 'block';
}

document.getElementById('mealForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('mealId').value;
    const mealData = {
        date: document.getElementById('mealDate').value,
        type: document.getElementById('mealType').value,
        menuItems: document.getElementById('mealMenu').value,
        bookingDeadline: new Date(document.getElementById('mealDeadline').value).toISOString()
    };
    let meals = getMeals();
    if (id) {
        // edit
        const index = meals.findIndex(m => m.id === id);
        if (index !== -1) {
            meals[index] = { ...meals[index], ...mealData };
        }
    } else {
        // add new
        mealData.id = Date.now().toString();
        meals.push(mealData);
    }
    saveMeals(meals);
    closeModal('mealModal');
    renderAdminDashboard();
    if (currentUser.role === 'user') renderUserDashboard();
});

// ---------------------------
// Waste Modal
// ---------------------------
function openWasteModal() {
    const modal = document.getElementById('wasteModal');
    const select = document.getElementById('wasteMealId');
    const meals = getMeals();
    select.innerHTML = meals.map(meal => `<option value="${meal.id}">${meal.type} - ${formatDate(meal.date)}</option>`).join('');
    document.getElementById('wasteForm').reset();
    modal.style.display = 'block';
}

document.getElementById('wasteForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const mealId = document.getElementById('wasteMealId').value;
    const prepared = parseInt(document.getElementById('preparedQuantity').value);
    const consumed = parseInt(document.getElementById('consumedQuantity').value);
    if (prepared < consumed) {
        alert('Consumed quantity cannot exceed prepared quantity.');
        return;
    }
    const wasted = prepared - consumed;
    const newLog = {
        id: Date.now().toString(),
        mealId: mealId,
        preparedQuantity: prepared,
        consumedQuantity: consumed,
        wastedQuantity: wasted,
        date: new Date().toISOString().split('T')[0]
    };
    const logs = getWasteLogs();
    logs.push(newLog);
    saveWasteLogs(logs);
    closeModal('wasteModal');
    renderAdminDashboard();
});

// ---------------------------
// Modal Helpers
// ---------------------------
function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}
window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = 'none';
    }
}
document.querySelectorAll('.close').forEach(btn => {
    btn.addEventListener('click', () => {
        btn.closest('.modal').style.display = 'none';
    });
});

// ---------------------------
// Authentication
// ---------------------------
function showAuth() {
    document.getElementById('authSection').style.display = 'flex';
    document.getElementById('userDashboard').style.display = 'none';
    document.getElementById('adminDashboard').style.display = 'none';
    document.getElementById('logoutBtn').style.display = 'none';
}
function showDashboard() {
    document.getElementById('authSection').style.display = 'none';
    document.getElementById('logoutBtn').style.display = 'block';
    if (currentUser.role === 'admin') {
        document.getElementById('userDashboard').style.display = 'none';
        document.getElementById('adminDashboard').style.display = 'block';
        renderAdminDashboard();
    } else {
        document.getElementById('adminDashboard').style.display = 'none';
        document.getElementById('userDashboard').style.display = 'block';
        renderUserDashboard();
    }
}
function handleLogin(email, password) {
    const users = getUsers();
    const user = users.find(u => u.email === email && u.password === password);
    if (user) {
        setCurrentUser(user);
        showDashboard();
    } else {
        document.getElementById('loginError').innerText = 'Invalid email or password.';
    }
}
function handleSignup(name, email, password, role) {
    const users = getUsers();
    if (users.find(u => u.email === email)) {
        document.getElementById('signupError').innerText = 'Email already exists.';
        return;
    }
    const newUser = {
        id: Date.now().toString(),
        name,
        email,
        password,
        role
    };
    users.push(newUser);
    saveUsers(users);
    setCurrentUser(newUser);
    showDashboard();
}

// ---------------------------
// Event Listeners & Initialization
// ---------------------------
document.addEventListener('DOMContentLoaded', () => {
    initData();
    loadCurrentUser();

    // Tab switching
    document.getElementById('loginTab').addEventListener('click', () => {
        document.getElementById('loginForm').classList.add('active');
        document.getElementById('signupForm').classList.remove('active');
        document.getElementById('loginTab').classList.add('active');
        document.getElementById('signupTab').classList.remove('active');
    });
    document.getElementById('signupTab').addEventListener('click', () => {
        document.getElementById('signupForm').classList.add('active');
        document.getElementById('loginForm').classList.remove('active');
        document.getElementById('signupTab').classList.add('active');
        document.getElementById('loginTab').classList.remove('active');
    });

    document.getElementById('loginForm').addEventListener('submit', (e) => {
        e.preventDefault();
        handleLogin(
            document.getElementById('loginEmail').value,
            document.getElementById('loginPassword').value
        );
    });
    document.getElementById('signupForm').addEventListener('submit', (e) => {
        e.preventDefault();
        handleSignup(
            document.getElementById('signupName').value,
            document.getElementById('signupEmail').value,
            document.getElementById('signupPassword').value,
            document.getElementById('signupRole').value
        );
    });
    document.getElementById('logoutBtn').addEventListener('click', () => {
        setCurrentUser(null);
        showAuth();
    });
    document.getElementById('addMealBtn').addEventListener('click', () => openMealModal());

    if (currentUser) {
        showDashboard();
    } else {
        showAuth();
    }
});