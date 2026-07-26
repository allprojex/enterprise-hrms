import '@testing-library/jest-dom';

// Radix UI primitives (DropdownMenu, Select, etc.) use the Pointer Events API
// for open/close and focus management, which jsdom doesn't implement —
// without these stubs a Radix trigger silently fails to open under fireEvent
// or userEvent in tests.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
