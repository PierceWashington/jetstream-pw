import { JetstreamRepoSourceUi, JetstreamRepoUi, Maybe, MetadataEndpoint, SalesforceOrgUi } from '@jetstream/types';
import { RadioButton, RadioGroup, ScopedNotification, Spinner, Tree, TreeItems } from '@jetstream/ui';
import { OrgsCombobox } from '@jetstream/ui-core';
import { salesforceOrgsOmitSelectedState } from '@jetstream/ui/app-state';
import { useAtomValue } from 'jotai';
import { FunctionComponent, useState } from 'react';
import { RepoSourcePicker } from '../repo-components/RepoSourcePicker';
import { FileItemMetadata } from './viewOrCompareMetadataTypes';

type CompareMode = 'org' | 'repo';

export interface ViewOrCompareMetadataSidebarProps {
  editorType: 'SOURCE' | 'TARGET' | 'DIFF';
  files: TreeItems<FileItemMetadata | null>[] | null;
  targetOrg?: SalesforceOrgUi | null;
  targetLoading: boolean;
  hasSourceResults: boolean;
  hasTargetResults: boolean;
  sourceError?: Maybe<string>;
  targetError?: Maybe<string>;
  isChromeExtension: boolean;
  treeSettingsContent?: React.ReactNode;
  onEditorTypeChange: (value: 'SOURCE' | 'TARGET' | 'DIFF') => void;
  onSelectedFile: (item: TreeItems<FileItemMetadata>) => void;
  /** Called when an org is selected as the compare target */
  onTargetOrgChange: (org: SalesforceOrgUi) => void;
  /** Called when a repo endpoint is selected as the compare target */
  onTargetEndpointChange?: (endpoint: MetadataEndpoint) => void;
}

export const ViewOrCompareMetadataSidebar: FunctionComponent<ViewOrCompareMetadataSidebarProps> = ({
  editorType,
  files,
  targetOrg,
  targetLoading,
  hasSourceResults,
  hasTargetResults,
  sourceError,
  targetError,
  isChromeExtension,
  treeSettingsContent,
  onEditorTypeChange,
  onSelectedFile,
  onTargetOrgChange,
  onTargetEndpointChange,
}) => {
  const orgs = useAtomValue(salesforceOrgsOmitSelectedState);
  const [compareMode, setCompareMode] = useState<CompareMode>('org');

  function handleSelectedFile(item: TreeItems<FileItemMetadata>) {
    if (item.meta) {
      onSelectedFile(item);
    }
  }

  function handleCompareModeChange(mode: CompareMode) {
    setCompareMode(mode);
  }

  function handleRepoSelected(repoSource: JetstreamRepoSourceUi, repo: JetstreamRepoUi, branch: string) {
    if (onTargetEndpointChange) {
      onTargetEndpointChange({ type: 'REPO', repo, branch });
    }
  }

  return (
    <>
      {!isChromeExtension && (
        <>
          <div className="slds-m-bottom_x-small">
            <RadioGroup label="Compare with" isButtonGroup>
              <RadioButton
                name="compare-mode"
                label="Org"
                value="org"
                checked={compareMode === 'org'}
                onChange={() => handleCompareModeChange('org')}
              />
              <RadioButton
                name="compare-mode"
                label="Repository"
                value="repo"
                checked={compareMode === 'repo'}
                disabled={!onTargetEndpointChange}
                onChange={() => handleCompareModeChange('repo')}
              />
            </RadioGroup>
          </div>

          <div className="slds-is-relative slds-m-bottom_x-small slds-m-right_x-small">
            {targetLoading && <Spinner />}
            {compareMode === 'org' ? (
              <OrgsCombobox
                label="Compare metadata with different org"
                hideLabel={false}
                placeholder="Select an org"
                orgs={orgs}
                selectedOrg={targetOrg}
                disabled={targetLoading || !!sourceError}
                minWidth={0}
                onSelected={onTargetOrgChange}
              />
            ) : (
              <RepoSourcePicker
                label="Compare metadata with repository"
                disabled={targetLoading || !!sourceError}
                onRepoSelected={handleRepoSelected}
              />
            )}
          </div>

          <div>
            <RadioGroup isButtonGroup>
              <RadioButton
                name="which-code"
                label="Source"
                value="SOURCE"
                checked={editorType === 'SOURCE'}
                disabled={!hasSourceResults || !!sourceError}
                onChange={(value) => onEditorTypeChange(value as 'SOURCE')}
              />
              <RadioButton
                name="which-code"
                label="target"
                value="TARGET"
                checked={editorType === 'TARGET'}
                disabled={!hasTargetResults || !!sourceError}
                onChange={(value) => onEditorTypeChange(value as 'TARGET')}
              />
              <RadioButton
                name="which-code"
                label="Compare"
                value="DIFF"
                checked={editorType === 'DIFF'}
                disabled={!hasSourceResults || !hasTargetResults || !!sourceError}
                onChange={(value) => onEditorTypeChange(value as 'DIFF')}
              />
            </RadioGroup>
          </div>
        </>
      )}
      {sourceError && (
        <ScopedNotification theme="error" className="slds-m-top_medium">
          There was an error getting metadata from the source org: {sourceError}
        </ScopedNotification>
      )}
      {targetError && (
        <ScopedNotification theme="error" className="slds-m-top_medium">
          There was an error getting metadata from the target: {targetError}
        </ScopedNotification>
      )}
      {treeSettingsContent && !sourceError && !targetError && treeSettingsContent}
      {!!files?.length && (
        <Tree
          header="Metadata Files"
          items={files}
          expandAllOnInit
          onlyEmitOnLeafNodeClick
          selectFirstLeafNodeOnInit
          reEmitSelectionOnItemsChange
          onSelected={handleSelectedFile}
        />
      )}
    </>
  );
};

export default ViewOrCompareMetadataSidebar;
