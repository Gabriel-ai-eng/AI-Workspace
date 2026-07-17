// Cliente mínimo da API do Vercel. O token fica no cofre criptografado e as
// chamadas são feitas direto do navegador (a API do Vercel permite CORS).

export interface VercelTeam {
  id: string
  name: string
}

export interface VercelProjectInfo {
  id: string
  name: string
  teamId?: string
  teamName?: string
}

export interface VercelDeploymentInfo {
  id: string
  url: string
  state: string
  target: 'production' | 'preview'
  createdAt: number
  ref?: string
  sha?: string
  message?: string
}

export class VercelClient {
  constructor(private token: string) {}

  private async req<T>(path: string, teamId?: string): Promise<T> {
    const url = new URL(`https://api.vercel.com${path}`)
    if (teamId) url.searchParams.set('teamId', teamId)
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${this.token}` },
    })
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`
      try {
        const body = (await res.json()) as { error?: { message?: string } }
        if (body.error?.message) msg = body.error.message
      } catch {
        // mantém a mensagem padrão
      }
      throw new Error(`Vercel: ${msg}`)
    }
    return (await res.json()) as T
  }

  async getUser(): Promise<{ username: string }> {
    const data = await this.req<{ user: { username?: string; name?: string; email?: string } }>(
      '/v2/user',
    )
    return { username: data.user.username ?? data.user.name ?? data.user.email ?? 'conta Vercel' }
  }

  async listTeams(): Promise<VercelTeam[]> {
    const data = await this.req<{ teams: { id: string; name: string }[] }>('/v2/teams')
    return data.teams ?? []
  }

  /** Agrega os projetos do escopo pessoal e de todos os times do token. */
  async listProjects(): Promise<VercelProjectInfo[]> {
    const out: VercelProjectInfo[] = []
    const scopes: (VercelTeam | null)[] = [null, ...(await this.listTeams().catch(() => []))]
    for (const scope of scopes) {
      try {
        const data = await this.req<{ projects: { id: string; name: string }[] }>(
          '/v9/projects',
          scope?.id,
        )
        for (const p of data.projects ?? []) {
          if (!out.some((o) => o.id === p.id)) {
            out.push({ id: p.id, name: p.name, teamId: scope?.id, teamName: scope?.name })
          }
        }
      } catch {
        // escopo sem acesso — ignora
      }
    }
    return out
  }

  /** Encontra um projeto pelo id, nome exato ou trecho do nome. */
  async findProject(nameOrId: string): Promise<VercelProjectInfo | null> {
    const projects = await this.listProjects()
    const t = nameOrId.trim().toLowerCase()
    if (!t) return null
    return (
      projects.find((p) => p.id === nameOrId || p.name.toLowerCase() === t) ??
      projects.find((p) => p.name.toLowerCase().includes(t)) ??
      null
    )
  }

  async listDeployments(
    projectId: string,
    teamId?: string,
    limit = 10,
  ): Promise<VercelDeploymentInfo[]> {
    const data = await this.req<{ deployments: Record<string, unknown>[] }>(
      `/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=${limit}`,
      teamId,
    )
    return (data.deployments ?? []).map(mapDeployment)
  }

  /** Busca um deploy por id (dpl_…) ou URL, tentando todos os escopos do token. */
  async getDeployment(idOrUrl: string, teamId?: string): Promise<Record<string, unknown>> {
    const clean = idOrUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
    const scopes: (string | undefined)[] = teamId
      ? [teamId]
      : [undefined, ...(await this.listTeams().catch(() => [])).map((t) => t.id)]
    let lastError: unknown = new Error('Deploy não encontrado.')
    for (const scope of scopes) {
      try {
        return await this.req<Record<string, unknown>>(
          `/v13/deployments/${encodeURIComponent(clean)}`,
          scope,
        )
      } catch (e) {
        lastError = e
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  /** Últimas linhas dos logs de build de um deploy (útil quando o build falha). */
  async getBuildLogs(deploymentId: string, teamId?: string): Promise<string> {
    const scopes: (string | undefined)[] = teamId
      ? [teamId]
      : [undefined, ...(await this.listTeams().catch(() => [])).map((t) => t.id)]
    let lastError: unknown = new Error('Logs não encontrados.')
    for (const scope of scopes) {
      try {
        const events = await this.req<unknown[]>(
          `/v3/deployments/${encodeURIComponent(deploymentId)}/events?limit=500`,
          scope,
        )
        const lines = (Array.isArray(events) ? events : [])
          .map((e) => {
            const ev = e as { text?: string; payload?: { text?: string } }
            return ev.payload?.text ?? ev.text ?? ''
          })
          .filter(Boolean)
        if (!lines.length) return '(sem logs disponíveis para este deploy)'
        return lines.slice(-300).join('\n')
      } catch (e) {
        lastError = e
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }
}

function mapDeployment(d: Record<string, unknown>): VercelDeploymentInfo {
  const meta = (d.meta ?? {}) as Record<string, string>
  return {
    id: String(d.uid ?? d.id ?? ''),
    url: String(d.url ?? ''),
    state: String(d.state ?? d.readyState ?? 'DESCONHECIDO'),
    target: d.target === 'production' ? 'production' : 'preview',
    createdAt: Number(d.created ?? d.createdAt ?? 0),
    ref: meta.githubCommitRef,
    sha: meta.githubCommitSha,
    message: meta.githubCommitMessage,
  }
}
