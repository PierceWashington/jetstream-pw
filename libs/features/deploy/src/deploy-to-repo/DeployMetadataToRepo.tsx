import { DeployMetadataTableRow, ListMetadataResult, SalesforceOrgUi } from '@jetstream/types';
import { Icon } from '@jetstream/ui';
import { Fragment, useState } from 'react';
import { convertRowsToMapOfListMetadataResults } from '../utils/deploy-metadata.utils';
import DeployMetadataToRepoModal from './DeployMetadataToRepoModal';

export interface DeployMetadataToRepoProps {
  selectedOrg: SalesforceOrgUi;
  loading: boolean;
  selectedRows: Set<DeployMetadataTableRow>;
}

export const DeployMetadataToRepo = ({ selectedOrg, loading, selectedRows }: DeployMetadataToRepoProps) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedMetadata, setSelectedMetadata] = useState<Record<string, ListMetadataResult[]>>();

  function handleClick() {
    setSelectedMetadata(convertRowsToMapOfListMetadataResults(Array.from(selectedRows)));
    setModalOpen(true);
  }

  return (
    <Fragment>
      <button
        className="slds-button slds-button_neutral"
        disabled={loading || selectedRows.size === 0}
        title="Commit the selected metadata to a GitHub repository branch."
        onClick={handleClick}
      >
        <Icon type="utility" icon="upload" className="slds-button__icon slds-button__icon_left" omitContainer />
        Deploy to Repository
      </button>

      {modalOpen && selectedMetadata && (
        <DeployMetadataToRepoModal sourceOrg={selectedOrg} selectedMetadata={selectedMetadata} onClose={() => setModalOpen(false)} />
      )}
    </Fragment>
  );
};

export default DeployMetadataToRepo;
