// Godbot: which folders the phone can offer for a working folder. The computer's `folders`
// answer says how it picks folders: `browse` lets the phone list any folder (`folder-list`);
// `native` (a local macOS dsh web) only opens the computer's own dialog, and refuses
// `folder-list`. Then the phone offers the team folder and the folders the team already
// uses, and says that other folders are picked on the computer.

export interface FoldersView {
  team?: string
  picker?: string | null
  folders?: { path: string; title?: string }[]
}

export interface FolderChoice { path: string; title: string; team: boolean }

export interface FolderPlan {
  /** The phone may list folders with `folder-list`. */
  browse: boolean
  /** Folders to offer: the team folder first, then the known ones, no duplicates. */
  choices: FolderChoice[]
}

const lastPart = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path

export function folderPlan(view: FoldersView | null | undefined): FolderPlan {
  const browse = view?.picker === 'browse'
  const choices: FolderChoice[] = []
  const seen = new Set<string>()
  const add = (path: unknown, title: unknown, team: boolean) => {
    if (typeof path !== 'string' || path === '' || seen.has(path)) return
    seen.add(path)
    choices.push({ path, title: typeof title === 'string' && title !== '' ? title : lastPart(path), team })
  }
  add(view?.team, undefined, true)
  for (const folder of view?.folders ?? []) add(folder?.path, folder?.title, false)
  return { browse, choices }
}
