import { useEffect, useRef, useState } from 'react'

export type Workspace = 'table' | 'tools'
export type ViewMode = '2d' | '3d' | 'sheet'
export type WorkspaceRoute = { workspace: Workspace; view: ViewMode }

const historyKey = 'weldingNavigation'
const isView = (value: unknown): value is ViewMode => value === '2d' || value === '3d' || value === 'sheet'

export function readWorkspaceRoute(url: URL): WorkspaceRoute {
  const workspace = url.searchParams.get('workspace') === 'table' ? 'table'
    : url.searchParams.get('workspace') === 'tools' || url.searchParams.has('toolProject') ? 'tools' : 'table'
  const requested = url.searchParams.get('view')
  const preferred = isView(requested) ? requested : '2d'
  return { workspace, view: workspace === 'tools' && preferred === 'sheet' ? '2d' : preferred }
}

export function workspaceUrl(url: URL, route: WorkspaceRoute): URL {
  const next = new URL(url)
  next.searchParams.set('workspace', route.workspace)
  next.searchParams.set('view', route.view)
  return next
}

export function useWorkspaceNavigation() {
  const [route, setRoute] = useState(() => readWorkspaceRoute(new URL(location.href)))
  const current = useRef(route)
  const position = useRef<number>(history.state?.[historyKey] ?? 0)
  current.current = route


  useEffect(() => {
    history.replaceState({ ...history.state, [historyKey]: position.current }, '', workspaceUrl(new URL(location.href), current.current))
    const pop = (event: PopStateEvent) => {
      const next = readWorkspaceRoute(new URL(location.href))
      const nextPosition: number = event.state?.[historyKey] ?? 0
      position.current = nextPosition
      setRoute(next)
    }
    window.addEventListener('popstate', pop)
    return () => window.removeEventListener('popstate', pop)
  }, [])

  const navigate = (next: WorkspaceRoute) => {
    if (next.workspace === current.current.workspace && next.view === current.current.view) return
    position.current += 1
    history.pushState({ ...history.state, [historyKey]: position.current }, '', workspaceUrl(new URL(location.href), next))
    setRoute(next)
  }
  return {
    ...route,
    navigate,
    selectWorkspace: (workspace: Workspace) => navigate({ workspace, view: '2d' }),
    selectView: (view: ViewMode) => navigate({ ...current.current, view }),
  }
}
