import { commitRepoFiles, retrieveMetadataFromListMetadata } from '@jetstream/shared/data';
import { pollRetrieveMetadataResultsUntilDone } from '@jetstream/shared/ui-utils';
import { getErrorMessage } from '@jetstream/shared/utils';
import { JetstreamRepoSourceUi, JetstreamRepoUi, ListMetadataResult, SalesforceOrgUi } from '@jetstream/types';
import { Icon, Modal, ScopedNotification, Spinner } from '@jetstream/ui';
import JSZip from 'jszip';
import isString from 'lodash/isString';
import { FunctionComponent, useState } from 'react';
import { RepoSourcePicker } from '../repo-components/RepoSourcePicker';

type DeployStatus = 'idle' | 'retrieving' | 'committing' | 'success' | 'error';

export interface DeployMetadataToRepoModalProps {
  sourceOrg: SalesforceOrgUi;
  /** Metadata types to retrieve from Salesforce. Required when preloadedFiles is not provided. */
  selectedMetadata?: Record<string, ListMetadataResult[]>;
  /**
   * Files already retrieved and path-mapped.  When provided the Salesforce
   * retrieve step is skipped and these files are committed directly.
   */
  preloadedFiles?: { path: string; content: string }[];
  onClose: () => void;
}

export const DeployMetadataToRepoModal: FunctionComponent<DeployMetadataToRepoModalProps> = ({
  sourceOrg,
  selectedMetadata,
  preloadedFiles,
  onClose,
}) => {
  const [repoSource, setRepoSource] = useState<JetstreamRepoSourceUi | null>(null);
  const [repo, setRepo] = useState<JetstreamRepoUi | null>(null);
  const [branch, setBranch] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [status, setStatus] = useState<DeployStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [commitUrl, setCommitUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isRunning = status === 'retrieving' || status === 'committing';
  const canDeploy = !!repo && !!branch && commitMessage.trim().length > 0 && !isRunning && status !== 'success';

  function handleRepoSelected(source: JetstreamRepoSourceUi, selectedRepo: JetstreamRepoUi, selectedBranch: string) {
    setRepoSource(source);
    setRepo(selectedRepo);
    setBranch(selectedBranch);
    // Reset any prior result when user changes the target
    if (status === 'success' || status === 'error') {
      setStatus('idle');
      setCommitUrl(null);
      setErrorMessage(null);
    }
  }

  async function handleDeploy() {
    if (!repo || !branch || !repoSource) return;
    const [owner, repoName] = repo.path.split('/');
    if (!owner || !repoName) return;

    setErrorMessage(null);
    setCommitUrl(null);

    let filesToCommit: { path: string; content: string }[];

    if (preloadedFiles) {
      // Files are already retrieved and path-mapped — go straight to commit
      filesToCommit = preloadedFiles;
      if (filesToCommit.length === 0) {
        setErrorMessage('No files were provided to commit');
        setStatus('error');
        return;
      }
    } else {
      // Retrieve metadata from Salesforce, then convert the zip to individual files
      setStatus('retrieving');
      setStatusMessage('Retrieving metadata from Salesforce...');

      try {
        const { id } = await retrieveMetadataFromListMetadata(sourceOrg, selectedMetadata!);

        const results = await pollRetrieveMetadataResultsUntilDone(sourceOrg, id, {
          onChecked: () => setStatusMessage('Waiting for Salesforce retrieve to complete...'),
        });

        if (!isString(results.zipFile)) {
          throw new Error(results.errorMessage || 'No data was returned from Salesforce');
        }

        const zip = await JSZip.loadAsync(results.zipFile, { base64: true });

        // Build filesToCommit by iterating zip.files directly.
        // fileProperties only lists primary component files; the zip also contains companion
        // -meta.xml files (e.g. MyClass.cls-meta.xml) required for a valid SFDX project.
        filesToCommit = [];
        for (const [zipPath, zipEntry] of Object.entries(zip.files)) {
          if (zipEntry.dir || !zipPath.startsWith('unpackaged/') || zipPath === 'unpackaged/package.xml') {
            continue;
          }
          filesToCommit.push({
            path: zipPath.replace(/^unpackaged\//, 'force-app/main/default/'),
            content: await zipEntry.async('string'),
          });
        }

        // Place package.xml under the manifest/ directory (SF CLI convention)
        const packageXml = await zip.file('unpackaged/package.xml')?.async('string');
        if (packageXml) {
          filesToCommit.push({ path: 'manifest/package.xml', content: packageXml });
        }

        if (filesToCommit.length === 0) {
          throw new Error('No files were retrieved from Salesforce');
        }
      } catch (ex) {
        setErrorMessage(getErrorMessage(ex));
        setStatus('error');
        return;
      }
    }

    setStatus('committing');
    setStatusMessage(`Committing ${filesToCommit.length} file(s) to ${repo.path}@${branch}...`);

    try {
      const result = await commitRepoFiles({
        repoSourceId: repoSource.id,
        owner,
        repo: repoName,
        branch,
        message: commitMessage.trim(),
        files: filesToCommit,
      });

      setCommitUrl(result.html_url);
      setStatus('success');
    } catch (ex) {
      setErrorMessage(getErrorMessage(ex));
      setStatus('error');
    }
  }

  return (
    <Modal
      header="Deploy Metadata to Repository"
      size="sm"
      closeDisabled={isRunning}
      footer={
        <div className="slds-grid slds-grid_align-spread">
          <button className="slds-button slds-button_neutral" disabled={isRunning} onClick={onClose}>
            {status === 'success' ? 'Close' : 'Cancel'}
          </button>
          {status !== 'success' && (
            <button className="slds-button slds-button_brand" disabled={!canDeploy} onClick={handleDeploy}>
              <Icon type="utility" icon="upload" className="slds-button__icon slds-button__icon_left" omitContainer />
              Deploy to Repository
            </button>
          )}
        </div>
      }
      onClose={onClose}
    >
      <div className="slds-p-around_medium slds-is-relative">
        {isRunning && <Spinner />}

        <RepoSourcePicker
          label="Target Repository & Branch"
          disabled={isRunning}
          onRepoSelected={handleRepoSelected}
        />

        <div className="slds-form-element slds-m-top_medium">
          <label className="slds-form-element__label" htmlFor="commit-message">
            <abbr className="slds-required" title="required">
              *
            </abbr>{' '}
            Commit Message
          </label>
          <div className="slds-form-element__control">
            <textarea
              id="commit-message"
              className="slds-textarea"
              placeholder="Describe the changes being deployed..."
              rows={3}
              value={commitMessage}
              disabled={isRunning}
              onChange={(e) => setCommitMessage(e.target.value)}
            />
          </div>
        </div>

        {(status === 'retrieving' || status === 'committing') && (
          <ScopedNotification theme="info" className="slds-m-top_medium">
            {statusMessage}
          </ScopedNotification>
        )}

        {status === 'success' && commitUrl && (
          <ScopedNotification theme="success" className="slds-m-top_medium">
            <p>
              Metadata successfully committed to <strong>{branch}</strong>.{' '}
              <a href={commitUrl} target="_blank" rel="noreferrer">
                View commit on GitHub
              </a>
            </p>
          </ScopedNotification>
        )}

        {status === 'error' && errorMessage && (
          <ScopedNotification theme="error" className="slds-m-top_medium">
            {errorMessage}
          </ScopedNotification>
        )}
      </div>
    </Modal>
  );
};

export default DeployMetadataToRepoModal;
