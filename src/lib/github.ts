// Cliente da API REST do GitHub autenticado com o Personal Access Token do
// usuário. Todas as chamadas partem do próprio dispositivo.

const API = 'https://api.github.com'

export interface GhRepo {
  full_name: string
  private: boolean
  default_branch: string
  description: string | null
  pushed_at: string
}

export interface GhTreeItem {
  path: string
  type: 'blob' | 'tree'
  size?: number
}

export class GitHubError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export class GitHubClient {
  private token: string

  constructor(token: string) {
    this.token = token
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`
      try {
        const body = await res.json()
        if (body?.message) msg = `${res.status}: ${body.message}`
      } catch {
        /* corpo não-JSON */
      }
      throw new GitHubError(res.status, msg)
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  async getUser(): Promise<{ login: string; avatar_url: string }> {
    return this.req('/user')
  }

  async listRepos(): Promise<GhRepo[]> {
    const all: GhRepo[] = []
    for (let page = 1; page <= 5; page++) {
      const batch = await this.req<GhRepo[]>(
        `/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`,
      )
      all.push(...batch)
      if (batch.length < 100) break
    }
    return all
  }

  async createRepo(name: string, isPrivate: boolean, description?: string): Promise<GhRepo> {
    return this.req('/user/repos', {
      method: 'POST',
      body: JSON.stringify({ name, private: isPrivate, description, auto_init: true }),
    })
  }

  async listBranches(repo: string): Promise<string[]> {
    const branches = await this.req<{ name: string }[]>(`/repos/${repo}/branches?per_page=100`)
    return branches.map((b) => b.name)
  }

  async getBranchSha(repo: string, branch: string): Promise<string> {
    const ref = await this.req<{ object: { sha: string } }>(
      `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
    )
    return ref.object.sha
  }

  async getTree(repo: string, branch: string): Promise<GhTreeItem[]> {
    const sha = await this.getBranchSha(repo, branch)
    const tree = await this.req<{ tree: GhTreeItem[]; truncated: boolean }>(
      `/repos/${repo}/git/trees/${sha}?recursive=1`,
    )
    return tree.tree
  }

  /** Retorna null se o arquivo não existir na branch. */
  async readFile(repo: string, path: string, branch: string): Promise<string | null> {
    try {
      const file = await this.req<{ content?: string; encoding?: string }>(
        `/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`,
      )
      if (file.content === undefined) return null
      const bin = atob(file.content.replace(/\n/g, ''))
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return new TextDecoder().decode(bytes)
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return null
      throw e
    }
  }

  async searchCode(repo: string, query: string): Promise<{ path: string; html_url: string }[]> {
    const q = encodeURIComponent(`${query} repo:${repo}`)
    const res = await this.req<{ items: { path: string; html_url: string }[] }>(
      `/search/code?q=${q}&per_page=20`,
    )
    return res.items
  }

  async createBranch(repo: string, name: string, fromSha: string): Promise<void> {
    await this.req(`/repos/${repo}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${name}`, sha: fromSha }),
    })
  }

  /**
   * Cria um commit com múltiplos arquivos (Git Data API):
   * blobs -> tree -> commit -> atualização da ref.
   */
  async commitFiles(
    repo: string,
    branch: string,
    message: string,
    files: { path: string; content?: string; delete?: boolean }[],
  ): Promise<{ sha: string; url: string }> {
    const headSha = await this.getBranchSha(repo, branch)
    const head = await this.req<{ tree: { sha: string } }>(`/repos/${repo}/git/commits/${headSha}`)

    const treeItems = await Promise.all(
      files.map(async (f) => {
        if (f.delete) {
          return { path: f.path, mode: '100644', type: 'blob', sha: null as string | null }
        }
        const blob = await this.req<{ sha: string }>(`/repos/${repo}/git/blobs`, {
          method: 'POST',
          body: JSON.stringify({ content: toBase64Utf8(f.content ?? ''), encoding: 'base64' }),
        })
        return { path: f.path, mode: '100644', type: 'blob', sha: blob.sha as string | null }
      }),
    )

    const tree = await this.req<{ sha: string }>(`/repos/${repo}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: head.tree.sha, tree: treeItems }),
    })

    const commit = await this.req<{ sha: string; html_url: string }>(`/repos/${repo}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message, tree: tree.sha, parents: [headSha] }),
    })

    await this.req(`/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha }),
    })

    return { sha: commit.sha, url: commit.html_url }
  }

  async createPull(
    repo: string,
    title: string,
    body: string,
    head: string,
    base: string,
  ): Promise<{ html_url: string; number: number }> {
    return this.req(`/repos/${repo}/pulls`, {
      method: 'POST',
      body: JSON.stringify({ title, body, head, base }),
    })
  }
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

function toBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
