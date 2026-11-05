/* Native Notes uses the component's scoped router, not the host history hooks. */
export function useLocation() {
  return ["/notes"] as const;
}
