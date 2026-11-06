// Registers @testing-library/jest-dom matchers (toBeInTheDocument etc.) when
// vitest runs with the jsdom environment. In the node environment the import
// is still safe but unused.
import "@testing-library/jest-dom/vitest";
