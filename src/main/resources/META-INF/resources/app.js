const feedback = document.querySelector('#feedback');
const refreshButton = document.querySelector('#refresh');
const statuses = ['TODO', 'DOING', 'DONE'];
const savedTickets = new Map();
const pendingTickets = new Set();
const editingTickets = new Set();
let draggedTicketId = null;
let refreshing = false;
let pendingCreates = 0;

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
        blockedNote: 'Blocking reason'
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
                ? 'This ticket could not be found. Refresh the board and try again.'
                : 'The server rejected the request without an explanation.';
    return `HTTP ${response.status}: ${(detail || plainText || fallback).slice(0, 1500)}`;
}

async function api(path = '', options = {}) {
    let response;
    let body;
    try {
        response = await fetch(`/api/tickets${path}`, {
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
    refreshButton.disabled = refreshing || pendingTickets.size > 0 || pendingCreates > 0;
}

function updateColumns() {
    for (const status of statuses) {
        const column = document.querySelector(`[data-status="${status}"]`);
        const cards = column.querySelector('.cards');
        const count = cards.querySelectorAll('.ticket').length;
        column.querySelector('.count').textContent = count;
        cards.querySelector('.empty')?.remove();
        if (!count) cards.append(element('p', 'empty', 'No tickets yet.'));
    }
}

function placeTicket(ticket, focusTarget) {
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
    updateColumns();
    if (focusTarget) card.querySelector(focusTarget)?.focus();
}

async function runCard(id, action, focusTarget = '.ticket-title') {
    id = String(id);
    if (refreshing || pendingTickets.has(id)) return;
    const card = cardFor(id);
    const focused = document.activeElement;
    const controls = [...card.querySelectorAll('button, input, textarea, summary')];
    const disabled = controls.map(control => control.disabled);
    pendingTickets.add(id);
    updateRefresh();
    clearDrag();
    card.setAttribute('aria-busy', 'true');
    controls.forEach(control => { control.disabled = true; });
    const message = card.querySelector('.ticket-feedback');
    message.classList.remove('error');
    message.textContent = 'Saving…';
    let saved = false;
    try {
        await action();
        saved = true;
    } catch (error) {
        message.textContent = error.message;
        message.classList.add('error');
    } finally {
        pendingTickets.delete(id);
        updateRefresh();
        if (card.isConnected) {
            card.removeAttribute('aria-busy');
            controls.forEach((control, index) => { control.disabled = disabled[index]; });
        }
        if (document.activeElement === document.body || card.contains(document.activeElement)) {
            if (saved) cardFor(id)?.querySelector(focusTarget)?.focus();
            else if (focused?.isConnected) focused.focus();
        }
    }
}

async function saveTicket(id, changes) {
    const current = savedTickets.get(String(id));
    const ticket = await api(`/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title: current.title,
            status: current.status,
            blocked: current.blocked,
            blockedNote: current.blockedNote,
            ...changes
        })
    });
    editingTickets.delete(String(id));
    placeTicket(ticket);
    const message = cardFor(id).querySelector('.ticket-feedback');
    message.textContent = 'Saved';
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
    runCard(id, () => saveTicket(id, { status }), '.drag-handle');
}

function openInlineEditor(id, mode) {
    if (refreshing || pendingTickets.has(id) || editingTickets.has(id)) return;
    const ticket = savedTickets.get(id);
    const card = cardFor(id);
    editingTickets.add(id);
    card.classList.add('editing');
    card.querySelector('.ticket-menu').open = false;
    card.querySelector('.ticket-menu').hidden = true;
    card.querySelectorAll('button').forEach(control => { control.disabled = true; });
    card.querySelector('.ticket-feedback').textContent = '';
    const original = card.querySelector(mode === 'title' ? '.ticket-heading' : '.blocker-section');
    original.hidden = true;
    const form = element('form', 'inline-editor');
    const field = element(mode === 'title' ? 'input' : 'textarea');
    field.id = `edit-${mode}-${id}`;
    field.name = mode;
    field.value = mode === 'title' ? ticket.title : ticket.blockedNote ?? '';
    if (mode === 'title') field.autocomplete = 'off';
    else field.rows = 3;
    const label = element('label', mode === 'title' ? 'sr-only' : '', mode === 'title' ? 'Ticket title' : 'What is blocking this ticket?');
    label.htmlFor = field.id;
    const hint = element('p', 'hint', mode === 'title' ? 'Enter to save · Esc to cancel' : 'Ctrl/⌘ + Enter to save · Esc to cancel');
    hint.id = `edit-help-${id}`;
    field.setAttribute('aria-describedby', hint.id);
    const actions = element('div', 'inline-actions');
    const save = button('Save', '', `Save ${mode} for ticket ${id}`);
    save.type = 'submit';
    const cancel = button('Cancel', 'quiet');
    const cancelEdit = () => {
        if (pendingTickets.has(id)) return;
        editingTickets.delete(id);
        placeTicket(savedTickets.get(id), mode === 'title' ? '.ticket-title' : '.blocker-summary, .ticket-menu summary');
    };
    cancel.addEventListener('click', cancelEdit);
    form.addEventListener('keydown', event => {
        if (event.isComposing) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            cancelEdit();
        } else if (mode !== 'title' && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            form.requestSubmit();
        }
    });
    form.addEventListener('submit', event => {
        event.preventDefault();
        const value = field.value;
        const changes = mode === 'title' ? { title: value } : { blocked: true, blockedNote: value };
        runCard(id, () => saveTicket(id, changes), mode === 'title' ? '.ticket-title' : '.blocker-summary');
    });
    actions.append(save, cancel);
    form.append(label, field, hint, actions);
    original.after(form);
    field.focus();
    if (mode === 'title') field.select();
}

function ticketCard(ticket) {
    const id = String(ticket.id);
    const card = element('article', `ticket${ticket.blocked ? ' blocked' : ''}`);
    card.dataset.ticketId = id;
    const header = element('div', 'ticket-header');
    const meta = element('div', 'ticket-meta', `#${id}`);
    if (ticket.blocked) meta.append(element('span', 'badge', 'BLOCKED'));
    const tools = element('div', 'ticket-tools');
    const handle = button('⠿', 'drag-handle', `Move ticket ${id}. Drag or use Left and Right arrow keys.`);
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
    handle.addEventListener('dragstart', event => {
        if (refreshing || pendingTickets.has(id) || editingTickets.has(id)) {
            event.preventDefault();
            return;
        }
        draggedTicketId = id;
        event.dataTransfer.setData('text/plain', id);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setDragImage(card, card.offsetWidth / 2, 20);
        card.classList.add('dragging');
    });
    handle.addEventListener('dragend', clearDrag);
    const menu = element('details', 'ticket-menu');
    const summary = element('summary', '', '⋯');
    summary.setAttribute('aria-label', `Actions for ticket ${id}`);
    summary.title = 'Ticket actions';
    summary.addEventListener('click', event => {
        if (pendingTickets.has(id) || refreshing) event.preventDefault();
    });
    const menuItems = element('div', 'ticket-menu-items');
    if (!ticket.blocked) {
        const block = button('Mark as blocked', 'quiet');
        block.addEventListener('click', () => openInlineEditor(id, 'blocker'));
        menuItems.append(block);
    }
    const remove = button('Delete ticket', 'quiet danger');
    remove.addEventListener('click', () => {
        if (pendingTickets.has(id) || refreshing || !window.confirm(`Delete ticket #${id}?`)) return;
        menu.open = false;
        runCard(id, async () => {
            await api(`/${id}`, { method: 'DELETE' });
            savedTickets.delete(id);
            card.remove();
            updateColumns();
            showFeedback(`Deleted ticket #${id}.`);
            if (document.activeElement === document.body) {
                document.querySelector(`[data-status="${ticket.status}"] .create-form input`).focus();
            }
        });
    });
    menuItems.append(remove);
    menu.append(summary, menuItems);
    menu.addEventListener('toggle', () => {
        if (!menu.open) return;
        document.querySelectorAll('.ticket-menu[open]').forEach(other => {
            if (other !== menu) other.open = false;
        });
    });
    menu.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            menu.open = false;
            summary.focus();
        }
    });
    tools.append(handle, menu);
    header.append(meta, tools);
    const heading = element('h3', 'ticket-heading');
    const title = button(ticket.title, 'ticket-title', `Edit title of ticket ${id}: ${ticket.title}`);
    title.title = 'Click to edit title';
    title.addEventListener('click', () => openInlineEditor(id, 'title'));
    heading.append(title);
    const blocker = element('div', 'blocker-section');
    if (ticket.blocked) {
        const note = button('', 'blocker-summary', `Edit blocker for ticket ${id}`);
        note.append(element('span', 'blocker-label', 'Waiting on'), element('span', 'blocker-preview', ticket.blockedNote));
        note.addEventListener('click', () => openInlineEditor(id, 'blocker'));
        const unblock = button('Unblock', 'unblock-action');
        unblock.addEventListener('click', () => runCard(id, () => saveTicket(id, { blocked: false, blockedNote: null })));
        blocker.append(note, unblock);
    }
    const message = element('p', 'ticket-feedback');
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');
    card.append(header, heading, blocker, message);
    return card;
}

async function loadTickets() {
    if (refreshing || pendingTickets.size || pendingCreates) return;
    const focused = document.activeElement;
    refreshing = true;
    updateRefresh();
    try {
        const tickets = await api();
        if (!Array.isArray(tickets)) throw new Error('Expected a ticket list from the server.');
        const received = new Set(tickets.map(ticket => String(ticket.id)));
        for (const id of savedTickets.keys()) {
            if (!received.has(id) && !editingTickets.has(id)) {
                savedTickets.delete(id);
                cardFor(id)?.remove();
            }
        }
        for (const ticket of tickets) {
            if (editingTickets.has(String(ticket.id))) savedTickets.set(String(ticket.id), ticket);
            else placeTicket(ticket);
        }
        updateColumns();
        showFeedback('Tickets refreshed.');
    } catch (error) {
        showFeedback(error.message, true);
    } finally {
        refreshing = false;
        updateRefresh();
        if (focused === refreshButton && document.activeElement === document.body) refreshButton.focus();
    }
}

document.addEventListener('click', event => {
    document.querySelectorAll('.ticket-menu[open]').forEach(menu => {
        if (!menu.contains(event.target)) menu.open = false;
    });
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
    input.addEventListener('input', () => {
        errorMessage.hidden = true;
    });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (refreshing || form.getAttribute('aria-busy') === 'true') return;
        const title = input.value;
        const status = form.closest('.column').dataset.status;
        errorMessage.hidden = true;
        form.setAttribute('aria-busy', 'true');
        input.disabled = true;
        pendingCreates++;
        updateRefresh();
        try {
            const ticket = await api('', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, status })
            });
            placeTicket(ticket);
            input.value = '';
            showFeedback(`Ticket created in ${status}.`);
        } catch (error) {
            errorMessage.hidden = false;
            errorMessage.textContent = error.message;
        } finally {
            pendingCreates--;
            form.removeAttribute('aria-busy');
            input.disabled = false;
            updateRefresh();
            if (document.activeElement === document.body || document.activeElement === input) input.focus();
        }
    });
});

refreshButton.addEventListener('click', loadTickets);
loadTickets();
