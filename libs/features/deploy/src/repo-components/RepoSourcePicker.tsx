import { createRepoBranch, deleteRepoSource, getRepoBranches, getRepoSources, getRepos, GitHubBranch } from '@jetstream/shared/data';
import { addRepoSource } from '@jetstream/shared/ui-utils';
import { DropDownItem, JetstreamRepoSourceUi, JetstreamRepoUi, ListItem } from '@jetstream/types';
import { ComboboxWithItems, DropDown, Icon, Modal, Spinner } from '@jetstream/ui';
import { applicationCookieState, selectedOrgState } from '@jetstream/ui/app-state';
import { fromDeployMetadataState } from '@jetstream/ui-core';
import { useAtom, useAtomValue } from 'jotai';
import { FunctionComponent, useCallback, useEffect, useRef, useState } from 'react';

const REPO_SELECTION_STORAGE_KEY_PREFIX = 'jetstream:repo-selection';
const NEW_BRANCH_ITEM_VALUE = '__new_branch__';

interface PersistedRepoSelection {
  repoId: string;
  sourceId: string;
  branch: string;
}

function loadPersistedSelection(orgId: string): PersistedRepoSelection | null {
  try {
    const raw = localStorage.getItem(`${REPO_SELECTION_STORAGE_KEY_PREFIX}:${orgId}`);
    return raw ? (JSON.parse(raw) as PersistedRepoSelection) : null;
  } catch {
    return null;
  }
}

function savePersistedSelection(orgId: string, selection: PersistedRepoSelection): void {
  try {
    localStorage.setItem(`${REPO_SELECTION_STORAGE_KEY_PREFIX}:${orgId}`, JSON.stringify(selection));
  } catch {
    // localStorage may be unavailable (private browsing, full quota, etc.)
  }
}

/** Items for the "Connect Source" / "Connect Another Source" dropdown. */
const CONNECT_SOURCE_ITEMS: DropDownItem[] = [
  {
    id: 'github',
    value: 'GitHub',
    icon: { type: 'utility', icon: 'connected_apps', description: 'GitHub' },
  },
  {
    id: 'bitbucket',
    value: 'Bitbucket (coming soon)',
    disabled: true,
    icon: { type: 'utility', icon: 'merge', description: 'Bitbucket' },
  },
];

export interface RepoSourcePickerProps {
  label?: string;
  disabled?: boolean;
  /** Called when a repo + branch selection is complete */
  onRepoSelected: (repoSource: JetstreamRepoSourceUi, repo: JetstreamRepoUi, branch: string) => void;
}

export const RepoSourcePicker: FunctionComponent<RepoSourcePickerProps> = ({ label = 'Repository', disabled, onRepoSelected }) => {
  const { serverUrl } = useAtomValue(applicationCookieState);
  const selectedOrg = useAtomValue(selectedOrgState);
  const [repoSources, setRepoSources] = useAtom(fromDeployMetadataState.repoSourcesState);

  const [repos, setRepos] = useState<JetstreamRepoUi[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<JetstreamRepoUi | null>(null);
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [connectingSource, setConnectingSource] = useState(false);
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);
  const [newBranchMode, setNewBranchMode] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  /** The branch to base the new branch on when creating one. Defaults to the first branch. */
  const [baseBranch, setBaseBranch] = useState<string | null>(null);
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [deletingSourceId, setDeletingSourceId] = useState<string | null>(null);

  /** Guard: only restore the persisted selection once per mount. */
  const hasRestoredSelection = useRef(false);
  const orgId = selectedOrg?.uniqueId;

  const loadRepos = useCallback(async () => {
    setLoadingRepos(true);
    try {
      const [repoResults, sourceResults] = await Promise.all([getRepos(), getRepoSources()]);
      setRepos(repoResults);
      setRepoSources((prev) => {
        const prevIds = new Set(prev.map(({ id }) => id));
        const newSources = sourceResults.filter(({ id }) => !prevIds.has(id));
        return newSources.length ? [...prev, ...newSources] : prev;
      });
    } finally {
      setLoadingRepos(false);
    }
  }, [setRepoSources]);

  useEffect(() => {
    loadRepos();
  }, [loadRepos]);

  /**
   * Once repos finish loading, attempt to restore the persisted selection for
   * the current Salesforce org.  The guard ref ensures this runs at most once.
   */
  useEffect(() => {
    if (hasRestoredSelection.current || loadingRepos || repos.length === 0 || !orgId) {
      return;
    }
    hasRestoredSelection.current = true;

    const persisted = loadPersistedSelection(orgId);
    if (!persisted) return;

    const matchingRepo = repos.find((r) => r.id === persisted.repoId);
    if (!matchingRepo) return;

    setSelectedRepo(matchingRepo);
    const [owner, repoName] = matchingRepo.path.split('/');
    if (!owner || !repoName) return;

    setLoadingBranches(true);
    getRepoBranches(matchingRepo.sourceId, owner, repoName)
      .then((fetchedBranches) => {
        setBranches(fetchedBranches);
        const branchExists = fetchedBranches.some(({ name }) => name === persisted.branch);
        if (!branchExists) return;

        setSelectedBranch(persisted.branch);
        const matchingSource = repoSources.find(({ id }) => id === persisted.sourceId);
        if (matchingSource) {
          onRepoSelected(matchingSource, matchingRepo, persisted.branch);
        }
      })
      .finally(() => setLoadingBranches(false));
  }, [loadingRepos, repos, orgId, repoSources, onRepoSelected]);

  const handleConnectSource = useCallback(
    (sourceType: 'github' | 'bitbucket') => {
      setConnectingSource(true);
      addRepoSource({ serverUrl, type: sourceType }, async (newSource: JetstreamRepoSourceUi) => {
        setConnectingSource(false);
        setRepoSources((prev) => {
          const exists = prev.some(({ id }) => id === newSource.id);
          return exists ? prev.map((s) => (s.id === newSource.id ? newSource : s)) : [newSource, ...prev];
        });
        await loadRepos();
      });
    },
    [serverUrl, setRepoSources, loadRepos],
  );

  const handleDeleteSource = useCallback(
    async (sourceId: string) => {
      setDeletingSourceId(sourceId);
      try {
        await deleteRepoSource(sourceId);
        setRepoSources((prev) => prev.filter(({ id }) => id !== sourceId));
        setRepos((prev) => prev.filter((r) => r.sourceId !== sourceId));
        if (selectedRepo?.sourceId === sourceId) {
          setSelectedRepo(null);
          setSelectedBranch(null);
          setBranches([]);
        }
      } finally {
        setDeletingSourceId(null);
      }
    },
    [selectedRepo, setRepoSources],
  );

  /** Fetch branches for a specific repo and update state. */
  const loadBranches = useCallback(async (repo: JetstreamRepoUi) => {
    const [owner, repoName] = repo.path.split('/');
    if (!owner || !repoName) return;
    setLoadingBranches(true);
    try {
      const fetchedBranches = await getRepoBranches(repo.sourceId, owner, repoName);
      setBranches(fetchedBranches);
      // Keep baseBranch in sync — default to current baseBranch or the first branch
      setBaseBranch((prev) => (prev && fetchedBranches.some(({ name }) => name === prev) ? prev : fetchedBranches[0]?.name ?? null));
    } finally {
      setLoadingBranches(false);
    }
  }, []);

  const handleRepoSelected = useCallback(
    async (item: ListItem<string, JetstreamRepoUi>) => {
      const repo = item.meta ?? null;
      setSelectedRepo(repo);
      setSelectedBranch(null);
      setBranches([]);
      setNewBranchMode(false);
      setNewBranchName('');

      if (!repo) return;
      await loadBranches(repo);
    },
    [loadBranches],
  );

  const handleBranchSelected = useCallback(
    (item: ListItem) => {
      if (item.value === NEW_BRANCH_ITEM_VALUE) {
        setNewBranchMode(true);
        setSelectedBranch(null);
        // Ensure baseBranch is populated so "Create Branch" button is enabled immediately
        setBaseBranch((prev) => prev ?? branches[0]?.name ?? null);
        return;
      }

      const branchName = item.value;
      setSelectedBranch(branchName);
      setNewBranchMode(false);

      if (!selectedRepo) return;
      const repoSource = repoSources.find(({ id }) => id === selectedRepo.sourceId);
      if (!repoSource) return;

      if (orgId) {
        savePersistedSelection(orgId, { repoId: selectedRepo.id, sourceId: repoSource.id, branch: branchName });
      }
      onRepoSelected(repoSource, selectedRepo, branchName);
    },
    [branches, selectedRepo, repoSources, orgId, onRepoSelected],
  );

  const handleNewBranchConfirm = useCallback(async () => {
    const branchName = newBranchName.trim();
    if (!branchName || !selectedRepo || !baseBranch) return;

    const repoSource = repoSources.find(({ id }) => id === selectedRepo.sourceId);
    if (!repoSource) return;

    const [owner, repoName] = selectedRepo.path.split('/');
    if (!owner || !repoName) return;

    setCreatingBranch(true);
    try {
      const newBranch = await createRepoBranch({
        repoSourceId: selectedRepo.sourceId,
        owner,
        repo: repoName,
        newBranch: branchName,
        sourceBranch: baseBranch,
      });

      // Add the new branch to the list and select it
      setBranches((prev) => [...prev, newBranch]);
      setSelectedBranch(branchName);
      setNewBranchMode(false);

      if (orgId) {
        savePersistedSelection(orgId, { repoId: selectedRepo.id, sourceId: repoSource.id, branch: branchName });
      }
      onRepoSelected(repoSource, selectedRepo, branchName);
    } finally {
      setCreatingBranch(false);
    }
  }, [newBranchName, baseBranch, selectedRepo, repoSources, orgId, onRepoSelected]);

  const repoItems: ListItem<string, JetstreamRepoUi>[] = repos.map((repo) => ({
    id: repo.id,
    label: repo.label || repo.path,
    title: repo.path,
    value: repo.id,
    secondaryLabel: repo.path !== (repo.label || repo.path) ? repo.path : undefined,
    meta: repo,
  }));

  /** Branch list with a "new branch" entry pinned at the top. */
  const branchItems: ListItem[] = [
    { id: NEW_BRANCH_ITEM_VALUE, label: '+ Enter new branch name', value: NEW_BRANCH_ITEM_VALUE },
    ...branches.map(({ name }) => ({ id: name, label: name, value: name })),
  ];

  const hasRepoSources = repoSources.length > 0;

  const connectSourceDropdown = (buttonLabel: string) => (
    <DropDown
      actionText="Connect a source"
      buttonClassName="slds-button slds-button_neutral"
      buttonContent={
        <>
          <Icon type="utility" icon="add" className="slds-button__icon slds-button__icon_left" omitContainer />
          {buttonLabel}
        </>
      }
      items={CONNECT_SOURCE_ITEMS}
      disabled={disabled || connectingSource}
      onSelected={(id) => handleConnectSource(id as 'github' | 'bitbucket')}
    />
  );

  return (
    <div>
      <div className="slds-form-element__label slds-no-flex">{label}</div>
      <div className="slds-is-relative">
        {(loadingRepos || connectingSource) && <Spinner />}
        <div className="slds-grid slds-gutters_x-small slds-grid_vertical-align-end">
          <div className="slds-col slds-grow">
            <ComboboxWithItems
              comboboxProps={{
                label: 'Repository',
                hideLabel: true,
                placeholder: 'Select a repository...',
                disabled: disabled || loadingRepos || connectingSource,
              }}
              items={repoItems}
              selectedItemId={selectedRepo?.id}
              onSelected={handleRepoSelected}
            />
          </div>

          {/* Refresh repos (and branches if a repo is selected) */}
          <div className="slds-col slds-no-flex">
            <button
              className="slds-button slds-button_icon slds-button_icon-border"
              title={selectedRepo ? 'Refresh repositories and branches' : 'Refresh repositories'}
              disabled={disabled || loadingRepos || loadingBranches || connectingSource}
              onClick={async () => {
                await loadRepos();
                if (selectedRepo) {
                  await loadBranches(selectedRepo);
                }
              }}
            >
              <Icon type="utility" icon="refresh" className="slds-button__icon" omitContainer />
              <span className="slds-assistive-text">Refresh</span>
            </button>
          </div>

          {/* Show "Connect Source" dropdown when no sources exist; cog to manage when sources exist. */}
          <div className="slds-col slds-no-flex">
            {!hasRepoSources ? (
              connectSourceDropdown('Connect Source')
            ) : (
              <button
                className="slds-button slds-button_icon slds-button_icon-border-filled"
                title="Manage connected sources"
                disabled={disabled || connectingSource}
                onClick={() => setIsManageModalOpen(true)}
              >
                <Icon type="utility" icon="settings" className="slds-button__icon" omitContainer />
                <span className="slds-assistive-text">Manage connected sources</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Branch selector — shown once a repo is selected. */}
      {selectedRepo && (
        <div className="slds-m-top_x-small slds-is-relative">
          {loadingBranches && <Spinner />}
          {newBranchMode ? (
            <div className="slds-form-element slds-is-relative">
              {creatingBranch && <Spinner />}
              <label className="slds-form-element__label">New Branch</label>
              <div className="slds-form-element__control slds-grid slds-gutters_x-small slds-grid_vertical-align-center">
                <div className="slds-col slds-grow">
                  <input
                    className="slds-input"
                    type="text"
                    placeholder="New branch name..."
                    value={newBranchName}
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                    disabled={creatingBranch}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleNewBranchConfirm()}
                  />
                </div>
                {/* Base branch selector */}
                <div className="slds-col slds-no-flex">
                  <div className="slds-form-element">
                    <label className="slds-form-element__label slds-text-body_small">Based on</label>
                    <div className="slds-form-element__control">
                      <div className="slds-select_container">
                        <select
                          className="slds-select"
                          value={baseBranch ?? ''}
                          disabled={creatingBranch}
                          onChange={(e) => setBaseBranch(e.target.value)}
                        >
                          {branches.map(({ name }) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="slds-col slds-no-flex">
                  <button
                    className="slds-button slds-button_brand"
                    disabled={!newBranchName.trim() || !baseBranch || creatingBranch}
                    onClick={handleNewBranchConfirm}
                  >
                    Create Branch
                  </button>
                </div>
                <div className="slds-col slds-no-flex">
                  <button className="slds-button slds-button_neutral" disabled={creatingBranch} onClick={() => setNewBranchMode(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <ComboboxWithItems
              comboboxProps={{
                label: 'Branch',
                placeholder: 'Select or create a branch...',
                disabled: disabled || loadingBranches,
              }}
              items={branchItems}
              selectedItemId={selectedBranch ?? undefined}
              onSelected={handleBranchSelected}
            />
          )}
        </div>
      )}

      {/* Manage Sources Modal — opened by the cog button when sources exist. */}
      {isManageModalOpen && (
        <Modal
          header="Manage Connected Sources"
          size="sm"
          footer={connectSourceDropdown('Connect Another Source')}
          onClose={() => setIsManageModalOpen(false)}
        >
          <ul className="slds-has-dividers_bottom-space">
            {repoSources.map((source) => (
              <li key={source.id} className="slds-item slds-grid slds-grid_vertical-align-center slds-p-vertical_x-small">
                <div className="slds-col slds-grow">
                  <div className="slds-text-body_regular">
                    <strong>
                      {source.type === 'github' ? 'GitHub' : source.type === 'bitbucket' ? 'Bitbucket' : 'Azure DevOps'}
                    </strong>
                  </div>
                  <div className="slds-text-body_small slds-text-color_weak">{source.userName}</div>
                </div>
                <div className="slds-col slds-no-flex">
                  <button
                    className="slds-button slds-button_icon slds-button_icon-border-filled"
                    title={`Disconnect ${source.userName}`}
                    disabled={!!deletingSourceId}
                    onClick={() => handleDeleteSource(source.id)}
                  >
                    <Icon type="utility" icon="delete" className="slds-button__icon" omitContainer />
                    <span className="slds-assistive-text">Disconnect {source.userName}</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
};

export default RepoSourcePicker;
