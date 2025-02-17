import { Grid, Icon } from '@jetstream/ui';
import { FunctionComponent } from 'react';
import { OrgType } from './viewOrCompareMetadataTypes';

export interface ViewOrCompareMetadataModalFooterProps {
  hasSourceMetadata: boolean;
  hasTargetMetadata: boolean;
  hasTargetMetadataContent: boolean;
  sourceLoading: boolean;
  sourceLastChecked: Date;
  targetLoading: boolean;
  targetLastChecked: Date;
  onDownloadPackage: (which: OrgType) => void;
  onExportSummary: () => void;
  onClose: () => void;
}

export const ViewOrCompareMetadataModalFooter: FunctionComponent<ViewOrCompareMetadataModalFooterProps> = ({
  hasSourceMetadata,
  hasTargetMetadata,
  hasTargetMetadataContent,
  sourceLoading,
  sourceLastChecked,
  targetLoading,
  targetLastChecked,
  onDownloadPackage,
  onExportSummary,
  onClose,
}) => {
  const hasBoth = hasSourceMetadata && hasTargetMetadata;
  return (
    <Grid align="spread" verticalAlign="center">
      <div>
        {sourceLoading && (
          <div className="slds-truncate" title={`last checked at ${sourceLastChecked.toLocaleTimeString()}`}>
            Loading metadata from Salesforce {sourceLastChecked && <span>- last checked at {sourceLastChecked.toLocaleTimeString()}</span>}
          </div>
        )}
        {targetLoading && (
          <div className="slds-truncate" title={`last checked at ${targetLastChecked.toLocaleTimeString()}`}>
            Loading metadata from Salesforce {targetLastChecked && <span>- last checked at {targetLastChecked.toLocaleTimeString()}</span>}
          </div>
        )}
      </div>
      <div>
        <button
          className="slds-button slds-button_neutral"
          onClick={() => onDownloadPackage('SOURCE')}
          disabled={!hasSourceMetadata || sourceLoading}
        >
          <Icon type="utility" icon="download" className="slds-button__icon slds-button__icon_left" omitContainer />
          Download Source Package
        </button>

        <button
          className="slds-button slds-button_neutral"
          onClick={() => onDownloadPackage('TARGET')}
          disabled={!hasTargetMetadata || targetLoading || !hasTargetMetadataContent}
        >
          <Icon type="utility" icon="download" className="slds-button__icon slds-button__icon_left" omitContainer />
          Download Target Package
        </button>

        <button className="slds-button slds-button_neutral" onClick={() => onExportSummary()} disabled={!hasBoth}>
          <Icon type="utility" icon="download" className="slds-button__icon slds-button__icon_left" omitContainer />
          Export Comparison
        </button>

        <button className="slds-button slds-button_neutral" onClick={() => onClose()}>
          Close
        </button>
      </div>
    </Grid>
  );
};

export default ViewOrCompareMetadataModalFooter;
