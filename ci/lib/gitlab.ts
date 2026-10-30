// Minimal GitLab REST client for the project this pipeline runs in.

export interface MergeRequest {
  iid: number;
  web_url: string;
}

export class GitLab {
  private readonly base: string;

  constructor(apiUrl: string, projectId: string, private readonly token: string) {
    this.base = `${apiUrl}/projects/${encodeURIComponent(projectId)}`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.base + path, {
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
    const mrs = await this.request<MergeRequest[]>("GET", `/merge_requests?${q}`);
    return mrs[0];
  }

  createMergeRequest(mr: {
    source_branch: string;
    target_branch: string;
    title: string;
    description: string;
    labels: string;
    remove_source_branch: boolean;
  }): Promise<MergeRequest> {
    return this.request("POST", "/merge_requests", mr);
  }

  /** `add_labels` keeps labels someone added by hand. */
  updateMergeRequest(
    iid: number,
    changes: { title: string; description: string; add_labels: string },
  ): Promise<MergeRequest> {
    return this.request("PUT", `/merge_requests/${iid}`, changes);
  }

  async comment(iid: number, body: string): Promise<void> {
    await this.request("POST", `/merge_requests/${iid}/notes`, { body });
  }
}
