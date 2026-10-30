// Minimal GitLab REST client for the project this pipeline runs in.

export interface MergeRequest {
  iid: number;
  web_url: string;
}

export class GitLab {
  /** Project-scoped path prefix; request() paths are relative to the API root. */
  private readonly project: string;

  constructor(
    private readonly apiUrl: string,
    projectId: string,
    private readonly token: string,
  ) {
    this.project = `/projects/${encodeURIComponent(projectId)}`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.apiUrl + path, {
      method,
      headers: {
        "PRIVATE-TOKEN": this.token,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`GitLab ${method} ${path}: ${res.status} ${await res.text()}`);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  /** The open MR whose source is `branch`, if any. */
  async openMergeRequestFor(branch: string): Promise<MergeRequest | undefined> {
    const q = new URLSearchParams({ state: "opened", source_branch: branch });
    const mrs = await this.request<MergeRequest[]>("GET", `${this.project}/merge_requests?${q}`);
    return mrs[0];
  }

  /** User id for a username, if the user exists. */
  async userId(username: string): Promise<number | undefined> {
    const q = new URLSearchParams({ username });
    const users = await this.request<{ id: number }[]>("GET", `/users?${q}`);
    return users[0]?.id;
  }

  createMergeRequest(mr: {
    source_branch: string;
    target_branch: string;
    title: string;
    description: string;
    labels: string;
    remove_source_branch: boolean;
    assignee_ids?: number[];
  }): Promise<MergeRequest> {
    return this.request("POST", `${this.project}/merge_requests`, mr);
  }

  /** `add_labels` keeps labels someone added by hand. */
  updateMergeRequest(
    iid: number,
    changes: { title: string; description: string; add_labels: string },
  ): Promise<MergeRequest> {
    return this.request("PUT", `${this.project}/merge_requests/${iid}`, changes);
  }

  async comment(iid: number, body: string): Promise<void> {
    await this.request("POST", `${this.project}/merge_requests/${iid}/notes`, { body });
  }
}
