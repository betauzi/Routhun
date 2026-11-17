const pages = Object.freeze({
 guest: ['track','public','architecture'],
 admin: ['overview','ledger','bank','allocations','expenses','proof','reports','audit','public','architecture','team'],
 staff: ['overview','ledger','bank','allocations','expenses','proof','reports','public'],
 board: ['overview','expenses','reports','audit','public'],
 auditor: ['overview','ledger','expenses','proof','reports','audit','public']
});
export function visiblePages(role) { return pages[role || 'guest'] || pages.guest; }
export function canVisit(role,page) { return page === 'track' || visiblePages(role).includes(page); }
