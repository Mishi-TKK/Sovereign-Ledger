// 1. Select all the HTML elements we need to interact with
const invoiceTotalElement = document.getElementById('invoice-total');
const progressBarFill = document.querySelector('.progress-bar-fill');
const invoiceItemsContainer = document.getElementById('invoice-items'); // New target
const taskListEl = document.getElementById('taskList'); // NEW: container for milestone checkboxes

// 2. Define the main function that calculates everything
function updateDashboard() {
    // NEW: queried fresh every time (instead of once at the top of the file)
    // so milestones added later are included, not just the original 4
    const checkboxes = document.querySelectorAll('.task-item input[type="checkbox"]');

    let totalCost = 0;
    let checkedCount = 0;
    const totalTasks = checkboxes.length;
    
    // Clear out the previous list inside the invoice to start fresh
    invoiceItemsContainer.innerHTML = '';

    // Loop through each checkbox to see if it is ticked
    checkboxes.forEach(checkbox => {
        if (checkbox.checked) {
            totalCost += parseFloat(checkbox.value);
            checkedCount++;

            // Grab the descriptive text next to the checkbox
            const itemText = checkbox.nextElementSibling.textContent;

            // Create a clean layout container for the printable line item
            const itemRow = document.createElement('div');
            itemRow.style.display = 'flex';
            itemRow.style.justifyContent = 'space-between';
            itemRow.style.padding = '0.4rem 0';
            itemRow.style.borderBottom = '1px dashed #e2e8f0';
            
            // Populate it with the description text
            itemRow.innerHTML = `<span>${itemText}</span>`;
            
            // Add this specific row directly into the invoice preview card
            invoiceItemsContainer.appendChild(itemRow);
        }
    });

    // If no tasks are checked, show a simple placeholder
    if (checkedCount === 0) {
        invoiceItemsContainer.innerHTML = '<p style="color: #94a3b8; font-style: italic;">No milestones selected.</p>';
    }

    // 3. Update the Invoice Total on the screen
    invoiceTotalElement.textContent = `£${totalCost}`;

    // 4. Calculate the progress percentage and update the Progress Bar visually
    const progressPercentage = totalTasks > 0 ? Math.round((checkedCount / totalTasks) * 100) : 0;
    
    progressBarFill.style.width = `${progressPercentage}%`;
    progressBarFill.textContent = `${progressPercentage}%`;
}

// 5. NEW: one listener on the container instead of one per checkbox — this way
// it automatically covers milestones added later too, no re-binding needed
taskListEl.addEventListener('change', (e) => {
    if (e.target.matches('input[type="checkbox"]')) {
        // NEW: also persist the checked/unchecked state into that project's
        // saved milestone list, so it's remembered when you switch away and back
        const project = getActiveProject();
        if (project) {
            const milestones = getMilestonesForProject(project.id);
            const milestone = milestones.find(m => m.id === e.target.id);
            if (milestone) {
                milestone.checked = e.target.checked;
                setMilestonesForProject(project.id, milestones);
            }
        }
        updateDashboard();
    }
});

// 7. Select the PDF print button component and attach print action trigger
//
// CHANGED: this button used to *only* call window.print(). Now it first
// creates and saves a real Invoice record (see the Invoices storage layer
// further down) from whichever milestones are currently checked, THEN opens
// the print dialog. This is what makes "Generate Invoice PDF" the same
// action as "Send" — the resulting invoice is created with status 'sent'.
const printButton = document.querySelector('.btn-print');
printButton.addEventListener('click', () => {
    const project = getActiveProject();
    if (!project) {
        alert('Add a project first before generating an invoice.');
        return;
    }

    const checkedMilestones = getMilestonesForProject(project.id).filter(m => m.checked);
    if (checkedMilestones.length === 0) {
        alert('Check at least one milestone before generating an invoice.');
        return;
    }

    const today = new Date();
    const dueDate = new Date();
    dueDate.setDate(today.getDate() + 14);

    const invoice = {
        id: `invoice-${crypto.randomUUID()}`,
        invoiceNumber: getNextInvoiceNumber(),
        clientId: project.clientId,
        projectId: project.id,
        // snapshot the line items as they are right now — if milestones are
        // edited/removed later, this invoice's own record won't change
        lineItems: checkedMilestones.map(m => ({ name: m.name, cost: m.cost })),
        amount: checkedMilestones.reduce((sum, m) => sum + parseFloat(m.cost), 0),
        issueDate: today.toISOString(),
        dueDate: dueDate.toISOString(),
        status: 'sent', // generating the PDF is currently the only "send" action in the app
        amountPaid: 0,
        datePaid: null,
        notes: '',
    };

    addInvoice(invoice);
    renderInvoices();

    window.print();
});

// 8. Dynamic Date Generator for Commercial Invoicing
//
// CHANGED: this used to run once on page load and never again, so the dates
// kept showing even after everything else (client, project) had been
// deleted and reset to "—". Now it takes a flag: pass true when there's an
// active project (recalculates today's date + a 14-day due date), or false
// to reset both fields to the placeholder, same as the other invoice fields.
function generateInvoiceDates(hasActiveProject) {
    if (!hasActiveProject) {
        document.getElementById('invoice-date').textContent = '--/--/----';
        document.getElementById('invoice-due-date').textContent = '--/--/----';
        return;
    }

    const today = new Date();
    
    // Calculate a standard 14-day payment window term
    const dueDate = new Date();
    dueDate.setDate(today.getDate() + 14);

    // Format dates cleanly for regional presentation (e.g., DD/MM/YYYY)
    const options = { year: 'numeric', month: '2-digit', day: '2-digit' };
    const formattedToday = today.toLocaleDateString('en-GB', options);
    const formattedDueDate = dueDate.toLocaleDateString('en-GB', options);

    // Inject the real-time calculated values straight into the invoice document
    document.getElementById('invoice-date').textContent = formattedToday;
    document.getElementById('invoice-due-date').textContent = formattedDueDate;
}


/* ==========================================================================
   NEW — everything below this line was added to wire up the sidebar tabs,
   the Clients feature, the Projects feature, per-project milestones, and
   (latest addition) the Invoices tab with statuses and payments.
   Nothing above this line was changed except the print button listener,
   which now also creates a saved Invoice record before printing.

   NOTE ON ORDERING: all the small "get/save" storage helpers and constants
   are defined first. All the "render" functions come next. All the actual
   function CALLS that run on page load are grouped into one "Init" block
   at the very bottom of the file, so nothing runs before the thing it
   depends on has been defined.
   ========================================================================== */

/* ---------- Small shared helper ---------- */
// basic guard so typed HTML in a name/address field can't break the page
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// NEW: decides whether to show a client's personal name or their company
// name, based on the choice made when that client was added. Falls back to
// the personal name if "company" was picked but no company name was entered
// (or for older clients saved before this feature existed).
function getClientDisplayName(client) {
    if (!client) return 'Unknown client';
    if (client.invoiceDisplayPreference === 'company' && client.companyName && client.companyName.trim()) {
        return client.companyName;
    }
    return client.name;
}


/* ---------- Clients: storage layer (localStorage for now) ---------- */
// Later, once there's a real database, only these functions need to change —
// the rest of the app just calls them.
const CLIENTS_STORAGE_KEY = 'clients';

function getClients() {
    const raw = localStorage.getItem(CLIENTS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
}

function saveClients(clients) {
    localStorage.setItem(CLIENTS_STORAGE_KEY, JSON.stringify(clients));
}

function addClient(client) {
    const clients = getClients();
    clients.push(client);
    saveClients(clients);
    return clients;
}

function deleteClient(id) {
    const clients = getClients().filter(c => c.id !== id);
    saveClients(clients);
    return clients;
}

// NEW: updates an existing client in place (used by the Edit feature) instead
// of adding a new one. Keeps the same id, so any projects already linked to
// this client stay linked correctly.
function updateClient(id, updatedFields) {
    const clients = getClients();
    const index = clients.findIndex(c => c.id === id);
    if (index !== -1) {
        clients[index] = { ...clients[index], ...updatedFields };
        saveClients(clients);
    }
    return clients;
}


/* ---------- Projects: storage layer (localStorage for now) ---------- */
const PROJECTS_STORAGE_KEY = 'projects';

function getProjects() {
    const raw = localStorage.getItem(PROJECTS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
}

function saveProjects(projects) {
    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
}

function addProject(project) {
    const projects = getProjects();
    projects.push(project);
    saveProjects(projects);
    return projects;
}

function deleteProject(id) {
    const projects = getProjects().filter(p => p.id !== id);
    saveProjects(projects);
    return projects;
}


/* ---------- Milestones: storage layer (NEW) ----------
   Stored as one object where each key is a project id and each value is
   that project's own array of milestones. This is what keeps Project A's
   phases from leaking into Project B. */
const MILESTONES_STORAGE_KEY = 'milestonesByProject';

function getAllMilestones() {
    const raw = localStorage.getItem(MILESTONES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
}

function saveAllMilestones(allMilestones) {
    localStorage.setItem(MILESTONES_STORAGE_KEY, JSON.stringify(allMilestones));
}

function getMilestonesForProject(projectId) {
    const all = getAllMilestones();
    return all[projectId] || []; // brand new project = empty list, as requested
}

function setMilestonesForProject(projectId, milestones) {
    const all = getAllMilestones();
    all[projectId] = milestones;
    saveAllMilestones(all);
}


/* ---------- Business name: storage layer (NEW) ----------
   Just one value, so it's simpler than the clients/projects lists — no id
   needed, there's only ever one freelancer using this copy of the app. */
const BUSINESS_NAME_KEY = 'freelancerBusinessName';

function getBusinessName() {
    return localStorage.getItem(BUSINESS_NAME_KEY) || 'Your Business Name';
}

function saveBusinessName(name) {
    localStorage.setItem(BUSINESS_NAME_KEY, name);
}


/* ---------- Active project tracker (NEW) ----------
   Keeps track of which project is currently "selected" so the tracker
   header, the milestone list, and the highlighted card can all match it. */
const CURRENT_PROJECT_KEY = 'currentProjectId';

function getCurrentProjectId() {
    return localStorage.getItem(CURRENT_PROJECT_KEY);
}

function setCurrentProjectId(id) {
    localStorage.setItem(CURRENT_PROJECT_KEY, id);
    renderCurrentProject();
    renderMilestones();
    renderProjects(); // re-draw the list so the highlight moves to the new card
}

// Works out which project should currently count as "active": the one saved
// in localStorage, or — if that one's missing/deleted — the most recently
// added project instead. Used by the header, the milestone list, AND the
// highlight logic, so they can never disagree with each other.
function getActiveProject() {
    const projects = getProjects();
    const currentId = getCurrentProjectId();
    let project = projects.find(p => p.id === currentId);

    if (!project && projects.length > 0) {
        project = projects[projects.length - 1];
        localStorage.setItem(CURRENT_PROJECT_KEY, project.id);
    }

    return project || null;
}


/* ---------- Invoices: storage layer (NEW) ----------
   Each invoice is its own saved record — separate from the live milestone
   preview — so it keeps its own line items, amount, and status even if the
   underlying project/milestones change later. */
const INVOICES_STORAGE_KEY = 'invoices';

function getInvoices() {
    const raw = localStorage.getItem(INVOICES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
}

function saveInvoices(invoices) {
    localStorage.setItem(INVOICES_STORAGE_KEY, JSON.stringify(invoices));
}

function addInvoice(invoice) {
    const invoices = getInvoices();
    invoices.push(invoice);
    saveInvoices(invoices);
    return invoices;
}

function updateInvoice(id, updatedFields) {
    const invoices = getInvoices();
    const index = invoices.findIndex(i => i.id === id);
    if (index !== -1) {
        invoices[index] = { ...invoices[index], ...updatedFields };
        saveInvoices(invoices);
    }
    return invoices;
}

function getNextInvoiceNumber() {
    const invoices = getInvoices();
    return `INV-${String(invoices.length + 1).padStart(4, '0')}`;
}

// NEW: removes an invoice record entirely. Used for clearing out test/mistake
// invoices — a real invoice would more often be "Cancelled" via the status
// dropdown instead, so its record (and history) is kept for reference.
function deleteInvoice(id) {
    const invoices = getInvoices().filter(i => i.id !== id);
    saveInvoices(invoices);
    return invoices;
}

// Overdue is never stored directly — it's worked out on the fly from the
// due date, so nothing needs a background job to "become" overdue. Paid /
// Cancelled always win over the date check.
function getDisplayStatus(invoice) {
    const unpaidStates = ['sent', 'partial'];
    if (unpaidStates.includes(invoice.status) && new Date(invoice.dueDate) < new Date()) {
        return 'overdue';
    }
    return invoice.status;
}

const STATUS_LABELS = {
    draft: 'Draft',
    sent: 'Sent',
    partial: 'Partially Paid',
    paid: 'Paid',
    overdue: 'Overdue',
    cancelled: 'Cancelled',
};


/* ---------- Clients: rendering the list ---------- */
const clientListEl = document.getElementById('clientList');
const clientListEmptyEl = document.getElementById('clientListEmpty');

function renderClients() {
    const clients = getClients();
    clientListEl.innerHTML = '';

    if (clients.length === 0) {
        clientListEmptyEl.style.display = 'block';
        return;
    }
    clientListEmptyEl.style.display = 'none';

    clients.forEach(client => {
        const li = document.createElement('li');
        li.className = 'client-card client-card-clickable';
        li.dataset.id = client.id;
        li.innerHTML = `
            <div class="client-card-info">
                <strong>${escapeHtml(client.name)}</strong>
                ${client.companyName ? `<span>${escapeHtml(client.companyName)}</span>` : ''}
                <span>${escapeHtml(client.email)}</span>
                <span>${escapeHtml(client.billingAddress)}</span>
                <span class="invoice-pref-tag">Invoices as: ${escapeHtml(getClientDisplayName(client))}</span>
            </div>
            <div class="client-card-actions">
                <button class="client-edit-btn" data-id="${client.id}">Edit</button>
                <button class="client-delete-btn" data-id="${client.id}">Remove</button>
            </div>
        `;
        clientListEl.appendChild(li);
    });

    // clicking anywhere on the card (except Edit/Remove) opens their project details
    document.querySelectorAll('#clientList .client-card-clickable').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.classList.contains('client-delete-btn') || e.target.classList.contains('client-edit-btn')) return;
            openClientDetails(card.dataset.id);
        });
    });

    // NEW: Edit opens the same modal used for adding, but pre-filled with this client's data
    document.querySelectorAll('#clientList .client-edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation(); // don't also trigger the card's click-to-open-details
            const client = getClients().find(c => c.id === btn.dataset.id);
            if (client) openClientModal(client);
        });
    });

    document.querySelectorAll('#clientList .client-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation(); // don't also trigger the card's click-to-open-details
            deleteClient(btn.dataset.id);
            renderClients();
            // FIX: deleting a client used to only refresh the Clients tab, so
            // if the deleted client belonged to the active project, the
            // Tracker header and the invoice preview's "Client:"/"To:" fields
            // kept showing the old name until you switched tabs or reloaded.
            // These three also re-check whether the active project still
            // makes sense now that its client may be gone.
            renderProjects();
            renderCurrentProject();
            renderMilestones();
        });
    });
}


/* ---------- Clients: modal open/close ---------- */
const clientModalOverlay = document.getElementById('clientModalOverlay');
const clientModalTitle = document.getElementById('clientModalTitle');
const clientFormSubmitBtn = document.getElementById('clientFormSubmitBtn');
const openClientModalBtn = document.getElementById('openClientModalBtn');
const closeClientModalBtn = document.getElementById('closeClientModalBtn');
const cancelClientBtn = document.getElementById('cancelClientBtn');
const clientForm = document.getElementById('clientForm');

// NEW: tracks which client is being edited (null = we're adding a new one instead)
let editingClientId = null;

// NEW: optional 'client' argument — pass an existing client to edit it,
// or call with no argument to add a new one (the original behavior).
function openClientModal(client = null) {
    if (client) {
        editingClientId = client.id;
        clientModalTitle.textContent = 'Edit Client';
        clientFormSubmitBtn.textContent = 'Update Client';

        document.getElementById('clientName').value = client.name || '';
        document.getElementById('clientEmail').value = client.email || '';
        document.getElementById('clientBillingAddress').value = client.billingAddress || '';
        document.getElementById('clientCompanyName').value = client.companyName || '';

        const preference = client.invoiceDisplayPreference === 'company' ? 'company' : 'name';
        document.querySelector(`input[name="invoiceDisplayPreference"][value="${preference}"]`).checked = true;
    } else {
        editingClientId = null;
        clientModalTitle.textContent = 'Add Client';
        clientFormSubmitBtn.textContent = 'Save Client';
        clientForm.reset();
    }

    clientModalOverlay.classList.add('open');
    document.getElementById('clientName').focus();
}

function closeClientModal() {
    clientModalOverlay.classList.remove('open');
    clientForm.reset();
    editingClientId = null; // NEW: always leave edit mode when the modal closes
}

openClientModalBtn.addEventListener('click', () => openClientModal());
closeClientModalBtn.addEventListener('click', closeClientModal);
cancelClientBtn.addEventListener('click', closeClientModal);

// clicking the dark overlay (outside the white box) also closes it
clientModalOverlay.addEventListener('click', (e) => {
    if (e.target === clientModalOverlay) closeClientModal();
});

// Escape key closes it too
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && clientModalOverlay.classList.contains('open')) {
        closeClientModal();
    }
});


/* ---------- Clients: saving the form ---------- */
clientForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const clientData = {
        name: document.getElementById('clientName').value.trim(),
        email: document.getElementById('clientEmail').value.trim(),
        billingAddress: document.getElementById('clientBillingAddress').value.trim(),
        companyName: document.getElementById('clientCompanyName').value.trim(),
        invoiceDisplayPreference: document.querySelector('input[name="invoiceDisplayPreference"]:checked').value,
    };

    if (editingClientId) {
        // NEW: editing an existing client — same id, so linked projects stay linked
        updateClient(editingClientId, clientData);
    } else {
        addClient({ id: crypto.randomUUID(), ...clientData });
    }

    renderClients();
    renderProjects();        // NEW: project cards show client names too — refresh them
    renderCurrentProject();  // NEW: the tracker header/invoice may show this client — refresh it
    closeClientModal();
});


/* ---------- "Select Client" dropdown ----------
   Looks at the client list (getClients()) and builds an <option> for each
   one. Runs every time the Add Project modal opens. */
const projectClientSelect = document.getElementById('projectClient');

function populateClientDropdown() {
    const clients = getClients();

    projectClientSelect.innerHTML = '';

    if (clients.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No clients yet — add one first';
        projectClientSelect.appendChild(opt);
        return;
    }

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select a client...';
    projectClientSelect.appendChild(placeholder);

    clients.forEach(client => {
        const opt = document.createElement('option');
        opt.value = client.id;
        opt.textContent = client.companyName ? `${client.name} (${client.companyName})` : client.name;
        projectClientSelect.appendChild(opt);
    });
}


/* ---------- Projects: rendering the list ---------- */
const projectListEl = document.getElementById('projectList');
const projectListEmptyEl = document.getElementById('projectListEmpty');

function renderProjects() {
    const projects = getProjects();
    const clients = getClients();
    const activeProject = getActiveProject(); // NEW: so we know which card to highlight
    projectListEl.innerHTML = '';

    if (projects.length === 0) {
        projectListEmptyEl.style.display = 'block';
        return;
    }
    projectListEmptyEl.style.display = 'none';

    projects.forEach(project => {
        const client = clients.find(c => c.id === project.clientId);
        const clientName = getClientDisplayName(client); // CHANGED: respects each client's invoice preference
        const isActive = activeProject && project.id === activeProject.id; // NEW

        const li = document.createElement('li');
        // NEW: "client-card-clickable" so clicking a project makes it active,
        // and "client-card-active" (only when isActive) for the highlight styling
        li.className = 'client-card client-card-clickable' + (isActive ? ' client-card-active' : '');
        li.dataset.id = project.id;
        li.innerHTML = `
            <div class="client-card-info">
                <strong>${escapeHtml(project.name)}</strong>
                <span>Client: ${escapeHtml(clientName)}</span>
                ${isActive ? '<span class="active-badge">● Currently working on</span>' : ''}
            </div>
            <button class="client-delete-btn" data-id="${project.id}">Remove</button>
        `;
        projectListEl.appendChild(li);
    });

    // NEW: clicking a project card (except the Remove button) makes it the
    // active project — updates the header, the milestone list, and the highlight.
    document.querySelectorAll('#projectList .client-card-clickable').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.classList.contains('client-delete-btn')) return; // let Remove handle itself
            setCurrentProjectId(card.dataset.id);
        });
    });

    document.querySelectorAll('#projectList .client-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation(); // don't also trigger the card's click-to-select
            deleteProject(btn.dataset.id);
            renderProjects();
            renderCurrentProject(); // in case the deleted project was the active one
            renderMilestones();     // ditto — swap to whatever project is now active
        });
    });
}


/* ---------- Project modal open/close ---------- */
const projectModalOverlay = document.getElementById('projectModalOverlay');
const openProjectModalBtn = document.getElementById('openProjectModalBtn');
const closeProjectModalBtn = document.getElementById('closeProjectModalBtn');
const cancelProjectBtn = document.getElementById('cancelProjectBtn');
const projectForm = document.getElementById('projectForm');

function openProjectModal() {
    populateClientDropdown();
    projectModalOverlay.classList.add('open');
    document.getElementById('projectName').focus();
}

function closeProjectModal() {
    projectModalOverlay.classList.remove('open');
    projectForm.reset();
}

openProjectModalBtn.addEventListener('click', openProjectModal);
closeProjectModalBtn.addEventListener('click', closeProjectModal);
cancelProjectBtn.addEventListener('click', closeProjectModal);

projectModalOverlay.addEventListener('click', (e) => {
    if (e.target === projectModalOverlay) closeProjectModal();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && projectModalOverlay.classList.contains('open')) {
        closeProjectModal();
    }
});


/* ---------- Project form submit — saves the project and makes it active ---------- */
projectForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const newProject = {
        id: crypto.randomUUID(),
        name: document.getElementById('projectName').value.trim(),
        clientId: document.getElementById('projectClient').value,
    };

    addProject(newProject);
    setCurrentProjectId(newProject.id); // a freshly added project becomes the active one
                                         // (its milestone list starts empty automatically,
                                         // since getMilestonesForProject() has nothing saved for it yet)
    closeProjectModal();
});


/* ---------- Current project header (NEW) ---------- */
const currentProjectNameEl = document.getElementById('currentProjectName');
const currentProjectClientEl = document.getElementById('currentProjectClient');
const invoiceClientEl = document.getElementById('invoice-client'); // NEW: the invoice's "To:" field

function renderCurrentProject() {
    const project = getActiveProject();

    if (!project) {
        currentProjectNameEl.textContent = 'No active project';
        currentProjectClientEl.textContent = 'Client: —';
        invoiceClientEl.textContent = '—'; // NEW
        generateInvoiceDates(false); // FIX: reset dates too, not just the client fields
        return;
    }

    const clients = getClients();
    const client = clients.find(c => c.id === project.clientId);
    const clientName = getClientDisplayName(client); // CHANGED: respects each client's invoice preference

    currentProjectNameEl.textContent = `Project: ${project.name}`;
    currentProjectClientEl.textContent = `Client: ${clientName}`;
    invoiceClientEl.textContent = clientName; // invoice "To:" now matches the active project's client
    generateInvoiceDates(true); // FIX: (re)calculate dates whenever there's an active project to show them for
}


/* ---------- Milestones: rendering (NEW) ----------
   Rebuilds the checklist to match whichever project is currently active.
   Switching projects calls this, so each client/project only ever shows
   its own phases. */
function renderMilestones() {
    const project = getActiveProject();
    taskListEl.innerHTML = '';

    if (!project) {
        updateDashboard();
        return;
    }

    const milestones = getMilestonesForProject(project.id);

    milestones.forEach(milestone => {
        const taskItem = document.createElement('div');
        taskItem.className = 'task-item';
        taskItem.innerHTML = `
            <input type="checkbox" id="${milestone.id}" value="${milestone.cost}" ${milestone.checked ? 'checked' : ''}>
            <label for="${milestone.id}">${escapeHtml(milestone.name)} (£${milestone.cost})</label>
            <button type="button" class="milestone-remove-btn" aria-label="Remove phase">&times;</button>
        `;
        taskListEl.appendChild(taskItem);
    });

    updateDashboard(); // recalculate the invoice total + progress bar for this project's milestones
}


/* ---------- Add / remove milestones (phases) ----------
   Saves into the active project's own milestone list, then re-renders. */
const milestoneForm = document.getElementById('milestoneForm');
const milestoneNameInput = document.getElementById('milestoneName');
const milestoneCostInput = document.getElementById('milestoneCost');

milestoneForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const name = milestoneNameInput.value.trim();
    const cost = milestoneCostInput.value;
    if (!name || !cost) return;

    const project = getActiveProject();
    if (!project) {
        alert('Add a project first before adding milestones.');
        return;
    }

    const milestones = getMilestonesForProject(project.id);
    milestones.push({
        id: `milestone-${crypto.randomUUID()}`,
        name,
        cost,
        checked: false,
    });
    setMilestonesForProject(project.id, milestones);

    milestoneForm.reset();
    renderMilestones();
});

// Remove button — delegated, so it works for any milestone, old or new
taskListEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('milestone-remove-btn')) {
        const taskItem = e.target.closest('.task-item');
        const checkbox = taskItem.querySelector('input[type="checkbox"]');
        const project = getActiveProject();

        if (project && checkbox) {
            const milestones = getMilestonesForProject(project.id).filter(m => m.id !== checkbox.id);
            setMilestonesForProject(project.id, milestones);
        }

        taskItem.remove();
        updateDashboard();
    }
});


/* ---------- Sidebar tab switching ---------- */
const navLinks = document.querySelectorAll('.nav-links a[data-tab]');
const tabPanels = document.querySelectorAll('.tab-panel');

navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault(); // stop the "#" from jumping the page to the top

        const targetId = link.dataset.tab;

        // turn off every link/panel, then turn on just the one clicked
        navLinks.forEach(l => l.classList.remove('active'));
        tabPanels.forEach(p => p.classList.remove('active'));

        link.classList.add('active');
        document.getElementById(targetId).classList.add('active');

        // NEW: Overdue status is time-based, so recompute it fresh every
        // time the Invoices tab is opened, not just when something changes.
        if (targetId === 'invoices-panel') {
            renderInvoices();
        }
    });
});


/* ---------- Click a client to see their projects ---------- */
const clientDetailsModalOverlay = document.getElementById('clientDetailsModalOverlay');
const closeClientDetailsBtn = document.getElementById('closeClientDetailsBtn');
const closeClientDetailsBtn2 = document.getElementById('closeClientDetailsBtn2');
const clientDetailsInfo = document.getElementById('clientDetailsInfo');
const clientDetailsProjects = document.getElementById('clientDetailsProjects');
const clientDetailsProjectsEmpty = document.getElementById('clientDetailsProjectsEmpty');

function openClientDetails(clientId) {
    const client = getClients().find(c => c.id === clientId);
    if (!client) return;

    clientDetailsInfo.innerHTML = `
        <p><strong>${escapeHtml(client.name)}</strong></p>
        ${client.companyName ? `<p>${escapeHtml(client.companyName)}</p>` : ''}
        <p>${escapeHtml(client.email)}</p>
        <p>${escapeHtml(client.billingAddress)}</p>
        <p class="invoice-pref-tag">Invoices as: ${escapeHtml(getClientDisplayName(client))}</p>
    `;

    const clientProjects = getProjects().filter(p => p.clientId === clientId);
    clientDetailsProjects.innerHTML = '';

    if (clientProjects.length === 0) {
        clientDetailsProjectsEmpty.style.display = 'block';
    } else {
        clientDetailsProjectsEmpty.style.display = 'none';
        clientProjects.forEach(project => {
            const li = document.createElement('li');
            li.className = 'client-card';
            li.innerHTML = `<div class="client-card-info"><strong>${escapeHtml(project.name)}</strong></div>`;
            clientDetailsProjects.appendChild(li);
        });
    }

    clientDetailsModalOverlay.classList.add('open');
}

function closeClientDetails() {
    clientDetailsModalOverlay.classList.remove('open');
}

closeClientDetailsBtn.addEventListener('click', closeClientDetails);
closeClientDetailsBtn2.addEventListener('click', closeClientDetails);

clientDetailsModalOverlay.addEventListener('click', (e) => {
    if (e.target === clientDetailsModalOverlay) closeClientDetails();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && clientDetailsModalOverlay.classList.contains('open')) {
        closeClientDetails();
    }
});


/* ---------- Business name: rendering + modal (NEW) ---------- */
const invoiceFromBusinessEl = document.getElementById('invoice-from-business');
const editBusinessNameBtn = document.getElementById('editBusinessNameBtn');
const businessModalOverlay = document.getElementById('businessModalOverlay');
const closeBusinessModalBtn = document.getElementById('closeBusinessModalBtn');
const cancelBusinessBtn = document.getElementById('cancelBusinessBtn');
const businessForm = document.getElementById('businessForm');
const businessNameInput = document.getElementById('businessName');

function renderBusinessName() {
    invoiceFromBusinessEl.textContent = getBusinessName();
}

function openBusinessModal() {
    businessNameInput.value = getBusinessName();
    businessModalOverlay.classList.add('open');
    businessNameInput.focus();
    businessNameInput.select(); // makes it quick to just retype over the current value
}

function closeBusinessModal() {
    businessModalOverlay.classList.remove('open');
}

editBusinessNameBtn.addEventListener('click', openBusinessModal);
closeBusinessModalBtn.addEventListener('click', closeBusinessModal);
cancelBusinessBtn.addEventListener('click', closeBusinessModal);

businessModalOverlay.addEventListener('click', (e) => {
    if (e.target === businessModalOverlay) closeBusinessModal();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && businessModalOverlay.classList.contains('open')) {
        closeBusinessModal();
    }
});

businessForm.addEventListener('submit', (e) => {
    e.preventDefault();
    saveBusinessName(businessNameInput.value.trim() || 'Your Business Name');
    renderBusinessName();
    closeBusinessModal();
});


/* ---------- Invoices: rendering the list (NEW) ---------- */
const invoiceListEl = document.getElementById('invoiceList');
const invoiceListEmptyEl = document.getElementById('invoiceListEmpty');

function renderInvoices() {
    const invoices = getInvoices();
    const clients = getClients();
    const projects = getProjects();
    invoiceListEl.innerHTML = '';

    if (invoices.length === 0) {
        invoiceListEmptyEl.style.display = 'block';
        return;
    }
    invoiceListEmptyEl.style.display = 'none';

    // newest first
    invoices.slice().reverse().forEach(invoice => {
        const client = clients.find(c => c.id === invoice.clientId);
        const project = projects.find(p => p.id === invoice.projectId);
        const displayStatus = getDisplayStatus(invoice);
        const remaining = (invoice.amount - invoice.amountPaid).toFixed(2);

        const li = document.createElement('li');
        li.className = 'client-card';
        li.innerHTML = `
            <div class="client-card-info">
                <strong>${escapeHtml(invoice.invoiceNumber)} — ${escapeHtml(getClientDisplayName(client))}</strong>
                <span>Project: ${escapeHtml(project ? project.name : 'Unknown')}${invoice.lineItems && invoice.lineItems.length ? ' (' + invoice.lineItems.map(li => escapeHtml(li.name)).join(', ') + ')' : ''}</span>
                <span>Amount: £${invoice.amount} &nbsp;|&nbsp; Paid: £${invoice.amountPaid} &nbsp;|&nbsp; Balance: £${remaining}</span>
                <span>Issued: ${new Date(invoice.issueDate).toLocaleDateString('en-GB')} &nbsp;|&nbsp; Due: ${new Date(invoice.dueDate).toLocaleDateString('en-GB')}</span>
                ${invoice.datePaid ? `<span>Paid on: ${new Date(invoice.datePaid).toLocaleDateString('en-GB')}</span>` : ''}
                ${invoice.notes ? `<span class="invoice-pref-tag">Note: ${escapeHtml(invoice.notes)}</span>` : ''}
                <span class="status-pill status-${displayStatus}">${STATUS_LABELS[displayStatus]}</span>
            </div>
            <div class="client-card-actions">
                <select class="invoice-status-select" data-id="${invoice.id}">
                    ${Object.entries(STATUS_LABELS).filter(([val]) => val !== 'overdue').map(([val, label]) =>
                        `<option value="${val}" ${invoice.status === val ? 'selected' : ''}>${label}</option>`
                    ).join('')}
                </select>
                <button type="button" class="client-delete-btn invoice-delete-btn" data-id="${invoice.id}" title="Permanently deletes this invoice. Use 'Cancelled' above instead for real invoices you no longer expect payment on.">Remove</button>
            </div>
        `;
        invoiceListEl.appendChild(li);
    });

    // NEW: permanently deletes the invoice record. Confirmed first since,
    // unlike removing a client or project, this can throw away real payment
    // history — for a genuine invoice, "Cancelled" (via the dropdown above)
    // is usually the better choice since it keeps the record.
    document.querySelectorAll('.invoice-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const invoice = getInvoices().find(i => i.id === btn.dataset.id);
            const label = invoice ? invoice.invoiceNumber : 'this invoice';
            if (confirm(`Permanently delete ${label}? This can't be undone and the record will be gone for good.\n\nIf this is a real invoice, consider setting its status to "Cancelled" instead — that keeps the record.`)) {
                deleteInvoice(btn.dataset.id);
                renderInvoices();
            }
        });
    });

    // Changing the dropdown updates the invoice's stored status. "Paid" and
    // "Partially Paid" route through the Record Payment modal instead of
    // applying immediately, since those two need an amount/date/notes too.
    document.querySelectorAll('.invoice-status-select').forEach(select => {
        select.addEventListener('change', (e) => {
            const invoiceId = e.target.dataset.id;
            const newStatus = e.target.value;

            if (newStatus === 'paid' || newStatus === 'partial') {
                openPaymentModal(invoiceId, newStatus);
                return; // don't save yet — wait for the payment form to be submitted
            }

            updateInvoice(invoiceId, { status: newStatus });
            renderInvoices();
        });
    });
}


/* ---------- Invoices: Record Payment modal (NEW) ----------
   Used for both "Partially Paid" and "Paid" — for "Paid" the amount is
   pre-filled with the full remaining balance and locked in as the total. */
const paymentModalOverlay = document.getElementById('paymentModalOverlay');
const paymentModalTitle = document.getElementById('paymentModalTitle');
const closePaymentModalBtn = document.getElementById('closePaymentModalBtn');
const cancelPaymentBtn = document.getElementById('cancelPaymentBtn');
const paymentForm = document.getElementById('paymentForm');
const paymentInvoiceIdInput = document.getElementById('paymentInvoiceId');
const paymentTargetStatusInput = document.getElementById('paymentTargetStatus');
const paymentInvoiceSummary = document.getElementById('paymentInvoiceSummary');
const paymentAmountInput = document.getElementById('paymentAmount');
const paymentDateInput = document.getElementById('paymentDate');
const paymentReferenceInput = document.getElementById('paymentReference');

function openPaymentModal(invoiceId, targetStatus) {
    const invoice = getInvoices().find(i => i.id === invoiceId);
    if (!invoice) return;

    paymentInvoiceIdInput.value = invoiceId;
    paymentTargetStatusInput.value = targetStatus;
    paymentModalTitle.textContent = targetStatus === 'paid' ? 'Mark as Paid' : 'Record Partial Payment';

    const remaining = (invoice.amount - invoice.amountPaid).toFixed(2);
    paymentInvoiceSummary.textContent = `${invoice.invoiceNumber} — total £${invoice.amount}, already paid £${invoice.amountPaid}, balance £${remaining}.`;

    paymentAmountInput.value = targetStatus === 'paid' ? invoice.amount : '';
    paymentDateInput.value = new Date().toISOString().split('T')[0]; // today, yyyy-mm-dd
    paymentReferenceInput.value = invoice.notes || '';

    paymentModalOverlay.classList.add('open');
    paymentAmountInput.focus();
}

function closePaymentModal() {
    paymentModalOverlay.classList.remove('open');
    paymentForm.reset();

    // NEW: if the modal is dismissed without saving, put the dropdown back
    // to reflect the invoice's actual saved status rather than leaving it
    // stuck on "Paid"/"Partially Paid" with nothing recorded.
    renderInvoices();
}

closePaymentModalBtn.addEventListener('click', closePaymentModal);
cancelPaymentBtn.addEventListener('click', closePaymentModal);

paymentModalOverlay.addEventListener('click', (e) => {
    if (e.target === paymentModalOverlay) closePaymentModal();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && paymentModalOverlay.classList.contains('open')) {
        closePaymentModal();
    }
});

paymentForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const invoiceId = paymentInvoiceIdInput.value;
    const targetStatus = paymentTargetStatusInput.value;
    const amountPaid = parseFloat(paymentAmountInput.value);

    if (isNaN(amountPaid) || amountPaid < 0) return;

    updateInvoice(invoiceId, {
        status: targetStatus,
        amountPaid,
        datePaid: new Date(paymentDateInput.value).toISOString(),
        notes: paymentReferenceInput.value.trim(),
    });

    paymentModalOverlay.classList.remove('open');
    paymentForm.reset();
    renderInvoices();
});


/* ==========================================================================
   INIT — everything that actually runs on page load, grouped in one place
   at the bottom so every function/constant it depends on already exists.
   ========================================================================== */
renderClients();
renderProjects();
renderCurrentProject();
renderMilestones();
renderBusinessName();
renderInvoices();