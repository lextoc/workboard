const feedback = document.querySelector('#feedback');
const refreshButton = document.querySelector('#refresh');
const projectFilter = document.querySelector('#project-filter');
const projectSummary = document.querySelector('#project-summary');
const manageProjectsButton = document.querySelector('#manage-projects');
const projectNotice = document.querySelector('#project-notice');
const projectDialog = document.querySelector('#project-dialog');
const managedProject = document.querySelector('#managed-project');
const projectForm = document.querySelector('#project-form');
const projectNameInput = document.querySelector('#project-name');
const projectFeedback = document.querySelector('#project-feedback');
const saveProjectButton = document.querySelector('#save-project');
const deleteProjectButton = document.querySelector('#delete-project');
const statuses = ['TODO', 'DOING', 'DONE'];
const savedTickets = new Map();
const pendingTickets = new Set();
const editingTickets = new Set();
const savedProjects = new Map();
let draggedTicketId = null;
let refreshing = false;
let pendingCreates = 0;
let projectCatalogReady = false;
let pendingProject = false;

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(text, className, label) {
    const node = element('button', className, text);
    node.type = 'button';
    if (label) node.setAttribute('aria-label', label);
    return node;
}

function icon(name) {
    const paths = {
        grip: 'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01',
        block: 'M6 6l12 12M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
        trash: 'M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6',
        left: 'M19 12H5m6-6-6 6 6 6',
        right: 'M5 12h14m-6-6 6 6-6 6',
        plus: 'M12 5v14M5 12h14',
        more: 'M5 12h.01M12 12h.01M19 12h.01'
    };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', paths[name]);
    svg.append(path);
    return svg;
}

function actionButton(text, iconName, className, label) {
    const control = button('', className, label);
    control.append(icon(iconName));
    if (text) control.append(element('span', '', text));
    return control;
}

function showFeedback(message, error = false) {
    feedback.textContent = message;
    feedback.classList.toggle('error', error);
}

function apiErrorMessage(response, data, body) {
    const text = value => typeof value === 'string' ? value.trim() : '';
    const labels = {
        title: 'Title',
        status: 'Status',
        blocked: 'Blocked',
        blockedNote: 'Blocking reason',
        projectId: 'Project',
        name: 'Project name'
    };
    const violations = Array.isArray(data?.violations)
        ? data.violations.flatMap(item => {
            const message = text(item?.message);
            if (!message) return [];
            const path = text(item?.field);
            const field = path.split('.').pop();
            return [path ? `${labels[field] || path}: ${message}` : message];
        })
        : [];
    if (violations.length) {
        return `HTTP ${response.status}:\n${[...new Set(violations)].join('\n')}`;
    }

    const detail = text(data?.detail) || text(data?.message) || text(data?.error)
        || text(data?.details).split('\n')[0] || text(data?.title) || text(data);
    const plainText = data === null && !response.headers.get('content-type')?.includes('html')
        && !body.trimStart().startsWith('<') ? body.trim() : '';
    const fallback = response.status >= 500
        ? 'The server could not process the request. Check the server logs for the cause.'
        : response.status === 400 || response.status === 422
            ? 'The server rejected the submitted values without an explanation. The API must return a validation message.'
            : response.status === 404
                ? 'This item could not be found. Refresh the board and try again.'
                : 'The server rejected the request without an explanation.';
    return `HTTP ${response.status}: ${(detail || plainText || fallback).slice(0, 1500)}`;
}

async function api(path = '', options = {}, resource = 'tickets') {
    let response;
    let body;
    try {
        response = await fetch(`/api/${resource}${path}`, {
            ...options,
            headers: { 'Accept': 'application/json', ...options.headers }
        });
        body = await response.text();
    } catch {
        throw new Error('Could not read a response from the API. Check your connection and refresh the board to confirm the saved state.');
    }
    let data;
    try {
        data = body ? JSON.parse(body) : null;
    } catch {
        data = null;
    }
    if (!response.ok) {
        throw new Error(apiErrorMessage(response, data, body));
    }
    if (body && data === null && response.status !== 204) {
        throw new Error('The server returned an unexpected response. Refresh to check the saved state.');
    }
    return data;
}

function cardFor(id) {
    return document.querySelector(`[data-ticket-id="${id}"]`);
}

function updateRefresh() {
    const busy = refreshing || pendingTickets.size > 0 || pendingCreates > 0 || pendingProject;
    refreshButton.disabled = busy;
    projectFilter.disabled = busy || editingTickets.size > 0;
    manageProjectsButton.disabled = busy || editingTickets.size > 0;
}

function normalizeTicket(ticket) {
    return {
        ...ticket,
        projectId: ticket.projectId ?? ticket.project?.id ?? null,
        projectName: ticket.projectName ?? ticket.project?.name ?? null
    };
}

function knownProjects() {
    const projects = new Map(savedProjects);
    for (const ticket of savedTickets.values()) {
        if (ticket.projectId && !projects.has(String(ticket.projectId))) {
            projects.set(String(ticket.projectId), { id: String(ticket.projectId), name: ticket.projectName ?? 'Unnamed project' });
        }
    }
    return [...projects.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function projectOption(value, label) {
    const option = element('option', '', label);
    option.value = value;
    return option;
}

function matchesProject(ticket) {
    return projectFilter.value === 'all'
        || (projectFilter.value === 'unassigned' ? !ticket.projectId : String(ticket.projectId) === projectFilter.value);
}

function updateProjectFilter() {
    const selected = projectFilter.value;
    projectFilter.replaceChildren(projectOption('all', 'All projects'), projectOption('unassigned', 'Unassigned'));
    for (const project of knownProjects()) projectFilter.append(projectOption(project.id, project.name));
    projectFilter.value = [...projectFilter.options].some(option => option.value === selected) ? selected : 'all';
}

function applyProjectFilter() {
    for (const ticket of savedTickets.values()) {
        const card = cardFor(ticket.id);
        if (card) card.hidden = !matchesProject(ticket);
    }
    const count = [...savedTickets.values()].filter(matchesProject).length;
    projectSummary.textContent = `${count} ${count === 1 ? 'ticket' : 'tickets'} · ${projectFilter.selectedOptions[0].textContent}`;
    updateColumns();
}

function populateProjectSelect(select, selected, emptyLabel = 'Unassigned') {
    select.replaceChildren(projectOption('', emptyLabel));
    for (const project of knownProjects()) select.append(projectOption(project.id, project.name));
    select.value = selected ?? '';
    if (select.selectedIndex < 0) select.value = '';
    select.disabled = !projectCatalogReady;
}

function syncProjectControls() {
    document.querySelectorAll('.create-project').forEach(select => {
        populateProjectSelect(select, select.value);
    });
    document.querySelectorAll('.ticket-project-select').forEach(select => {
        const ticket = savedTickets.get(select.dataset.projectTicketId);
        populateProjectSelect(select, ticket?.projectId);
    });
    populateProjectSelect(managedProject, managedProject.value, 'New project');
    updateProjectForm();
}

function updateProjectForm() {
    const project = savedProjects.get(managedProject.value);
    projectNameInput.value = project?.name ?? '';
    saveProjectButton.textContent = project ? 'Save name' : 'Create project';
    deleteProjectButton.hidden = !project;
    projectForm.querySelectorAll('input, button').forEach(control => {
        control.disabled = pendingProject || !projectCatalogReady;
    });
    managedProject.disabled = pendingProject || !projectCatalogReady;
}

async function loadProjects() {
    try {
        const projects = await api('', {}, 'projects');
        if (!Array.isArray(projects) || projects.some(project => !project?.id || typeof project.name !== 'string')) {
            throw new Error('Expected a project list from the server.');
        }
        savedProjects.clear();
        projects.forEach(project => savedProjects.set(String(project.id), project));
        projectCatalogReady = true;
        projectNotice.hidden = true;
    } catch (error) {
        projectCatalogReady = false;
        projectNotice.textContent = 'Project management and assignment are unavailable. You can still view and filter existing assignments. Refresh the board to retry.';
        projectNotice.hidden = false;
        projectFeedback.textContent = error.message;
        projectFeedback.classList.add('error');
    }
    syncProjectControls();
}

function updateColumns() {
    const emptyMessages = {
        TODO: 'Ready for your next task',
        DOING: 'Nothing in progress',
        DONE: 'No completed tasks'
    };
    for (const status of statuses) {
        const column = document.querySelector(`[data-status="${status}"]`);
        const cards = column.querySelector('.cards');
        const count = cards.querySelectorAll('.ticket:not([hidden])').length;
        column.querySelector('.count').textContent = count;
        cards.querySelector('.empty')?.remove();
        if (!count) cards.append(element('p', 'empty', emptyMessages[status]));
    }
}

function placeTicket(ticket, focusTarget) {
    ticket = normalizeTicket(ticket);
    const id = String(ticket.id);
    savedTickets.set(id, ticket);
    const oldCard = cardFor(id);
    const card = ticketCard(ticket);
    const cards = document.querySelector(`[data-status="${ticket.status}"] .cards`);
    if (oldCard?.parentElement === cards) {
        oldCard.replaceWith(card);
    } else {
        oldCard?.remove();
        const next = [...cards.querySelectorAll('.ticket')]
            .find(item => item.dataset.ticketId > id);
        cards.insertBefore(card, next ?? null);
    }
    updateProjectFilter();
    applyProjectFilter();
    if (focusTarget) card.querySelector(focusTarget)?.focus();
}

async function runCard(id, action, focusTarget = '.ticket-title') {
    id = String(id);
    if (refreshing || pendingTickets.has(id)) return;
    const card = cardFor(id);
    const focused = document.activeElement;
    const controls = [...card.querySelectorAll('button, input, textarea, select')];
    const disabled = controls.map(control => control.disabled);
    pendingTickets.add(id);
    updateRefresh();
    clearDrag();
    card.setAttribute('aria-busy', 'true');
    card.draggable = false;
    controls.forEach(control => { control.disabled = true; });
    const message = card.querySelector('.ticket-feedback');
    message.classList.remove('error', 'sr-only');
    message.textContent = 'Saving…';
    let saved = false;
    try {
        await action();
        saved = true;
    } catch (error) {
        const currentMessage = cardFor(id)?.querySelector('.ticket-feedback') ?? message;
        currentMessage.textContent = error.message;
        currentMessage.classList.remove('sr-only');
        currentMessage.classList.add('error');
        const projectSelect = cardFor(id)?.querySelector('.ticket-project-select');
        if (projectSelect) projectSelect.value = savedTickets.get(id)?.projectId ?? '';
        if (cardFor(id)?.hidden) showFeedback(error.message, true);
    } finally {
        pendingTickets.delete(id);
        updateRefresh();
        if (card.isConnected) {
            card.removeAttribute('aria-busy');
            card.draggable = !editingTickets.has(id);
            controls.forEach((control, index) => { control.disabled = disabled[index]; });
        }
        if (cardFor(id)?.hidden) {
            projectFilter.focus();
        } else if (document.activeElement === document.body || card.contains(document.activeElement)) {
            if (saved) cardFor(id)?.querySelector(focusTarget)?.focus();
            else if (focused?.isConnected) {
                const target = focused.closest('[hidden]') ? card.querySelector('.ticket-menu-trigger') : focused;
                target?.focus();
            }
        }
    }
}

async function saveTicket(id, changes) {
    const current = savedTickets.get(String(id));
    await api(`/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title: current.title,
            status: current.status,
            blocked: current.blocked,
            blockedNote: current.blockedNote,
            projectId: current.projectId,
            ...changes
        })
    });
    const ticket = normalizeTicket(await api(`/${id}`));
    editingTickets.delete(String(id));
    placeTicket(ticket);
    const message = cardFor(id).querySelector('.ticket-feedback');
    message.classList.add('sr-only');
    message.textContent = 'Saved';
    const expectedProjectId = Object.hasOwn(changes, 'projectId') ? changes.projectId : current.projectId;
    if (ticket.projectId !== expectedProjectId) {
        throw new Error('The ticket was saved, but its project assignment was not applied. Refresh the board before trying again.');
    }
    if (!matchesProject(ticket)) {
        showFeedback('Ticket saved. It is now outside the selected project view.');
    }
}

function clearDrag() {
    draggedTicketId = null;
    document.querySelectorAll('.drop-target, .dragging').forEach(node => {
        node.classList.remove('drop-target', 'dragging');
    });
}

function canMove(id, status) {
    const ticket = savedTickets.get(id);
    return ticket && !refreshing && !pendingTickets.has(id) && !editingTickets.has(id)
        && ticket.status !== status;
}

function moveTicket(id, status) {
    if (!canMove(id, status)) return;
    runCard(id, () => saveTicket(id, { status }), '.ticket-menu-trigger');
}

function openInlineEditor(id, mode) {
    if (refreshing || pendingTickets.has(id) || editingTickets.has(id)) return;
    const ticket = savedTickets.get(id);
    const card = cardFor(id);
    editingTickets.add(id);
    updateRefresh();
    card.classList.add('editing');
    card.draggable = false;
    closeTicketMenus();
    card.querySelectorAll('button').forEach(control => { control.disabled = true; });
    card.querySelector('.ticket-feedback').textContent = '';
    const original = card.querySelector(mode === 'title' ? '.ticket-heading' : '.blocker-section');
    original.hidden = true;
    const form = element('form', 'inline-editor');
    const field = element('textarea');
    field.id = `edit-${mode}-${id}`;
    field.name = mode;
    field.value = mode === 'title' ? ticket.title : ticket.blockedNote ?? '';
    field.rows = mode === 'title' ? 2 : 3;
    if (mode === 'title') field.autocomplete = 'off';
    const label = element('label', mode === 'title' ? 'sr-only' : '', mode === 'title' ? 'Ticket title' : 'What is blocking this ticket?');
    label.htmlFor = field.id;
    const hint = element('p', 'hint', 'Ctrl/⌘ + Enter to save · Esc to cancel');
    hint.id = `edit-help-${id}`;
    field.setAttribute('aria-describedby', hint.id);
    const actions = element('div', 'inline-actions');
    const save = button('Save', '', `Save ${mode} for ticket ${id}`);
    save.type = 'submit';
    const cancel = button('Cancel', 'quiet');
    const cancelEdit = () => {
        if (pendingTickets.has(id)) return;
        editingTickets.delete(id);
        updateRefresh();
        placeTicket(savedTickets.get(id), mode === 'title' ? '.ticket-title' : '.ticket-menu-trigger');
    };
    cancel.addEventListener('click', cancelEdit);
    form.addEventListener('keydown', event => {
        if (event.isComposing) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            cancelEdit();
        } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            form.requestSubmit();
        }
    });
    form.addEventListener('submit', event => {
        event.preventDefault();
        const value = field.value;
        const changes = mode === 'title' ? { title: value } : { blocked: true, blockedNote: value };
        runCard(id, () => saveTicket(id, changes), mode === 'title' ? '.ticket-title' : '.ticket-menu-trigger');
    });
    actions.append(save, cancel);
    form.append(label, field, hint, actions);
    original.after(form);
    field.focus();
    if (mode === 'title') field.select();
}

function closeTicketMenus(except) {
    document.querySelectorAll('.ticket-menu-trigger').forEach(trigger => {
        if (trigger === except) return;
        trigger.dispatchEvent(new Event('close-ticket-menu'));
    });
}

function ticketCard(ticket) {
    const id = String(ticket.id);
    const card = element('article', `ticket${ticket.blocked ? ' blocked' : ''}`);
    card.dataset.ticketId = id;
    card.draggable = true;
    let suppressClick = false;
    card.addEventListener('pointerdown', event => {
        card.draggable = !refreshing && !pendingTickets.has(id) && !editingTickets.has(id)
            && (!event.target.closest('.ticket-menu') || !!event.target.closest('.drag-handle'));
    });
    card.addEventListener('click', event => {
        if (suppressClick || event.target.closest('.ticket-menu, .inline-editor')) return;
        if (editingTickets.has(id)) {
            card.querySelector('textarea[name="title"]')?.focus();
            return;
        }
        openInlineEditor(id, 'title');
    });
    const header = element('div', 'ticket-header');
    const heading = element('h3', 'ticket-heading');
    const title = button(ticket.title, 'ticket-title', `Edit title of ticket ${id}: ${ticket.title}`);
    title.title = ticket.blocked ? `Blocked: ${ticket.blockedNote}` : 'Click to edit title';
    heading.append(title);
    if (ticket.blocked) {
        const badge = element('span', 'blocked-indicator');
        badge.setAttribute('role', 'img');
        badge.setAttribute('aria-label', 'Blocked');
        badge.title = 'Blocked';
        heading.prepend(badge);
    }
    const menu = element('div', 'ticket-menu');
    const trigger = actionButton('', 'more', 'quiet icon-button ticket-menu-trigger', `Actions for ticket ${id}: ${ticket.title}`);
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', `ticket-actions-${id}`);
    const panel = element('div', 'ticket-menu-items');
    panel.id = `ticket-actions-${id}`;
    panel.hidden = true;
    panel.append(element('p', 'ticket-reference', `#${id.slice(0, 8)}`));
    panel.querySelector('.ticket-reference').title = id;
    const projectField = element('div', 'ticket-project-field');
    const projectLabel = element('label', '', 'Project');
    const projectSelect = element('select', 'ticket-project-select');
    projectSelect.id = `project-${id}`;
    projectSelect.dataset.projectTicketId = id;
    projectLabel.htmlFor = projectSelect.id;
    populateProjectSelect(projectSelect, ticket.projectId);
    projectSelect.addEventListener('change', () => {
        const projectId = projectSelect.value || null;
        runCard(id, () => saveTicket(id, { projectId }), '.ticket-menu-trigger');
    });
    projectField.append(projectLabel, projectSelect);
    panel.append(projectField);
    let hoverTimer;
    let leaveTimer;
    trigger.addEventListener('close-ticket-menu', () => {
        clearTimeout(hoverTimer);
        clearTimeout(leaveTimer);
        trigger.setAttribute('aria-expanded', 'false');
        panel.hidden = true;
    });
    const openMenu = () => {
        clearTimeout(hoverTimer);
        clearTimeout(leaveTimer);
        if (!card.isConnected || refreshing || pendingTickets.has(id) || editingTickets.has(id) || draggedTicketId) return;
        closeTicketMenus(trigger);
        panel.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
    };
    trigger.addEventListener('click', () => {
        clearTimeout(hoverTimer);
        clearTimeout(leaveTimer);
        if (panel.hidden) openMenu();
        else closeTicketMenus();
    });
    menu.addEventListener('pointerenter', event => {
        if (event.pointerType !== 'mouse') return;
        clearTimeout(leaveTimer);
        hoverTimer = setTimeout(openMenu, 250);
    });
    menu.addEventListener('pointerleave', event => {
        if (event.pointerType !== 'mouse') return;
        clearTimeout(hoverTimer);
        leaveTimer = setTimeout(() => {
            if (!menu.contains(document.activeElement)) {
                trigger.setAttribute('aria-expanded', 'false');
                panel.hidden = true;
            }
        }, 250);
    });
    menu.addEventListener('focusout', event => {
        if (menu.contains(event.relatedTarget)) return;
        clearTimeout(hoverTimer);
        clearTimeout(leaveTimer);
        trigger.setAttribute('aria-expanded', 'false');
        panel.hidden = true;
    });
    menu.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !panel.hidden) {
            event.preventDefault();
            clearTimeout(hoverTimer);
            clearTimeout(leaveTimer);
            closeTicketMenus();
            trigger.focus();
        } else if (event.key === 'ArrowDown' && event.target === trigger) {
            event.preventDefault();
            openMenu();
            panel.querySelector('button, select')?.focus();
        }
    });
    const handle = actionButton('Drag to move', 'grip', 'quiet drag-handle', `Move ticket ${id}. Drag or use Left and Right arrow keys.`);
    handle.draggable = true;
    handle.title = 'Drag to move · ← / → when focused';
    handle.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight');
    handle.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        const destination = statuses[statuses.indexOf(ticket.status) + direction];
        if (destination) moveTicket(id, destination);
    });
    card.addEventListener('dragstart', event => {
        if (refreshing || pendingTickets.has(id) || editingTickets.has(id) || !card.draggable) {
            event.preventDefault();
            return;
        }
        suppressClick = true;
        closeTicketMenus();
        draggedTicketId = id;
        event.dataTransfer.setData('text/plain', id);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setDragImage(card, card.offsetWidth / 2, 20);
        card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
        clearDrag();
        setTimeout(() => { suppressClick = false; }, 0);
    });
    const remove = actionButton('Delete ticket', 'trash', 'quiet danger', `Delete ticket ${id}: ${ticket.title}`);
    remove.title = 'Delete ticket';
    remove.addEventListener('click', () => {
        if (pendingTickets.has(id) || editingTickets.has(id) || refreshing
            || !window.confirm(`Delete “${ticket.title}” (#${id.slice(0, 8)})?`)) return;
        runCard(id, async () => {
            await api(`/${id}`, { method: 'DELETE' });
            savedTickets.delete(id);
            card.remove();
            updateProjectFilter();
            applyProjectFilter();
            showFeedback(`Deleted ticket #${id.slice(0, 8)}.`);
            if (document.activeElement === document.body) {
                document.querySelector(`[data-status="${ticket.status}"] .create-form input`).focus();
            }
        });
    });
    const blocker = element('div', 'blocker-section');
    if (ticket.blocked) {
        const note = button('', 'blocker-summary', `Edit blocking reason for ticket ${id}: ${ticket.blockedNote}`);
        note.append(element('span', 'blocker-label', 'Blocked · edit reason'), element('span', 'blocker-preview', ticket.blockedNote));
        note.addEventListener('click', () => openInlineEditor(id, 'blocker'));
        const unblock = button('Unblock', 'quiet unblock-action');
        unblock.addEventListener('click', () => runCard(id, () => saveTicket(id, { blocked: false, blockedNote: null }), '.ticket-menu-trigger'));
        panel.append(note, unblock);
    } else {
        const block = actionButton('Block ticket', 'block', 'quiet block-action', `Block ticket ${id}`);
        block.addEventListener('click', () => openInlineEditor(id, 'blocker'));
        panel.append(block);
    }
    const statusIndex = statuses.indexOf(ticket.status);
    for (const direction of [-1, 1]) {
        const destination = statuses[statusIndex + direction];
        if (!destination) continue;
        const labels = { TODO: 'Move to To do', DOING: direction > 0 ? 'Start ticket' : 'Reopen ticket', DONE: 'Complete ticket' };
        const move = actionButton(labels[destination], direction < 0 ? 'left' : 'right', 'quiet move-action',
            `${labels[destination]}: move ticket ${id} to ${destination}`);
        move.addEventListener('click', () => moveTicket(id, destination));
        panel.append(move);
    }
    panel.append(handle, remove);
    menu.append(trigger, panel);
    header.append(heading, menu);
    const message = element('p', 'ticket-feedback');
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');
    const projectBadge = element('p', `project-badge${ticket.projectId ? '' : ' unassigned'}`,
        ticket.projectId ? ticket.projectName ?? 'Unnamed project' : 'Unassigned');
    projectBadge.title = ticket.projectName ?? 'No project assigned';
    card.append(header, projectBadge, blocker, message);
    return card;
}

async function loadTickets() {
    if (refreshing || pendingTickets.size || pendingCreates || pendingProject) return;
    const focused = document.activeElement;
    refreshing = true;
    updateRefresh();
    try {
        await loadProjects();
        const tickets = await api();
        if (!Array.isArray(tickets)) throw new Error('Expected a ticket list from the server.');
        const received = new Set(tickets.map(ticket => String(ticket.id)));
        for (const id of savedTickets.keys()) {
            if (!received.has(id) && !editingTickets.has(id)) {
                savedTickets.delete(id);
                cardFor(id)?.remove();
            }
        }
        for (const rawTicket of tickets) {
            const ticket = normalizeTicket(rawTicket);
            if (editingTickets.has(String(ticket.id))) savedTickets.set(String(ticket.id), ticket);
            else placeTicket(ticket);
        }
        updateProjectFilter();
        applyProjectFilter();
        syncProjectControls();
        showFeedback('Tickets refreshed.');
    } catch (error) {
        showFeedback(error.message, true);
    } finally {
        refreshing = false;
        updateRefresh();
        if (focused === refreshButton && document.activeElement === document.body) refreshButton.focus();
    }
}

document.addEventListener('pointerdown', event => {
    if (!event.target.closest('.ticket-menu')) closeTicketMenus();
});

document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeTicketMenus();
});

document.querySelectorAll('.column').forEach(column => {
    column.addEventListener('dragover', event => {
        if (!canMove(draggedTicketId, column.dataset.status)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        column.classList.add('drop-target');
    });
    column.addEventListener('dragleave', event => {
        if (!column.contains(event.relatedTarget)) column.classList.remove('drop-target');
    });
    column.addEventListener('drop', event => {
        const id = draggedTicketId;
        if (!id) return;
        event.preventDefault();
        const transferredId = event.dataTransfer.getData('text/plain');
        clearDrag();
        if (transferredId === id) moveTicket(id, column.dataset.status);
    });
});

document.querySelectorAll('.create-form').forEach(form => {
    const input = form.elements.title;
    const errorMessage = form.querySelector('.create-error');
    const submit = form.querySelector('button[type="submit"]');
    const projectLabel = element('label', 'create-project-label', 'Project');
    const projectSelect = element('select', 'create-project');
    projectSelect.id = `${input.id}-project`;
    projectSelect.name = 'projectId';
    projectLabel.htmlFor = projectSelect.id;
    populateProjectSelect(projectSelect, null);
    form.querySelector('.create-controls').after(projectLabel, projectSelect);
    submit.prepend(icon('plus'));
    input.addEventListener('input', () => {
        errorMessage.hidden = true;
    });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (refreshing || form.getAttribute('aria-busy') === 'true') return;
        const title = input.value;
        const status = form.closest('.column').dataset.status;
        const projectId = projectSelect.value || null;
        errorMessage.hidden = true;
        form.setAttribute('aria-busy', 'true');
        input.disabled = true;
        submit.disabled = true;
        projectSelect.disabled = true;
        pendingCreates++;
        updateRefresh();
        try {
            const created = await api('', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, status, projectId })
            });
            input.value = '';
            const ticket = normalizeTicket(await api(`/${created.id}`));
            placeTicket(ticket);
            if (ticket.projectId !== projectId) {
                throw new Error('The ticket was created, but its project assignment was not applied. Refresh the board before trying again.');
            }
            showFeedback(`Ticket created in ${status}.${matchesProject(ticket) ? '' : ' It is outside the selected project view.'}`);
        } catch (error) {
            errorMessage.hidden = false;
            errorMessage.textContent = error.message;
        } finally {
            pendingCreates--;
            form.removeAttribute('aria-busy');
            input.disabled = false;
            submit.disabled = false;
            projectSelect.disabled = !projectCatalogReady;
            updateRefresh();
            if (document.activeElement === document.body || document.activeElement === input || document.activeElement === submit) input.focus();
        }
    });
});

refreshButton.addEventListener('click', loadTickets);
projectFilter.addEventListener('change', () => {
    closeTicketMenus();
    applyProjectFilter();
    document.querySelectorAll('.create-project').forEach(select => {
        select.value = ['all', 'unassigned'].includes(projectFilter.value) ? '' : projectFilter.value;
    });
});

manageProjectsButton.addEventListener('click', () => {
    closeTicketMenus();
    projectFeedback.textContent = projectCatalogReady ? '' : 'Project management is unavailable. Close this window and refresh the board to retry.';
    projectFeedback.classList.toggle('error', !projectCatalogReady);
    updateProjectForm();
    projectDialog.showModal();
    if (projectCatalogReady) projectNameInput.focus();
});

document.querySelector('#close-projects').addEventListener('click', () => {
    if (!pendingProject) projectDialog.close();
});

projectDialog.addEventListener('cancel', event => {
    if (pendingProject) event.preventDefault();
});

managedProject.addEventListener('change', () => {
    projectFeedback.textContent = '';
    updateProjectForm();
    projectNameInput.focus();
});

async function mutateProject(action, successMessage) {
    if (pendingProject || !projectCatalogReady) return;
    pendingProject = true;
    updateRefresh();
    projectForm.setAttribute('aria-busy', 'true');
    projectDialog.querySelectorAll('button, input, select').forEach(control => { control.disabled = true; });
    projectFeedback.classList.remove('error');
    projectFeedback.textContent = 'Saving…';
    try {
        await action();
        pendingProject = false;
        await loadTickets();
        projectFeedback.textContent = successMessage;
        if (projectCatalogReady) projectNameInput.focus();
    } catch (error) {
        projectFeedback.textContent = error.message;
        projectFeedback.classList.add('error');
    } finally {
        pendingProject = false;
        projectForm.removeAttribute('aria-busy');
        projectDialog.querySelectorAll('button, input, select').forEach(control => { control.disabled = false; });
        if (!projectCatalogReady) {
            projectForm.querySelectorAll('button, input').forEach(control => { control.disabled = true; });
            managedProject.disabled = true;
        }
        updateRefresh();
    }
}

projectForm.addEventListener('submit', event => {
    event.preventDefault();
    const id = managedProject.value;
    const name = projectNameInput.value;
    mutateProject(async () => {
        await api(id ? `/${encodeURIComponent(id)}` : '', {
            method: id ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        }, 'projects');
    }, id ? 'Project renamed.' : 'Project created. Choose it when adding or editing a ticket.');
});

deleteProjectButton.addEventListener('click', () => {
    const id = managedProject.value;
    const project = savedProjects.get(id);
    if (!project || !window.confirm(`Delete project “${project.name}”?`)) return;
    mutateProject(async () => {
        await api(`/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'projects');
        managedProject.value = '';
    }, 'Project deleted.');
});

loadTickets();
