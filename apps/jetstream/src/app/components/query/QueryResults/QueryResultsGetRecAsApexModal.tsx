import { css } from '@emotion/react';
import { logger } from '@jetstream/shared/client-logger';
import { describeSObject } from '@jetstream/shared/data';
import { useNonInitialEffect } from '@jetstream/shared/ui-utils';
import { MapOf, SalesforceOrgUi } from '@jetstream/types';
import { AxeIllustration, EmptyState, Grid, GridCol, Icon, Modal, Spinner } from '@jetstream/ui';
import Editor from '@monaco-editor/react';
import copyToClipboard from 'copy-to-clipboard';
import type { Field, FieldType } from 'jsforce';
import { FunctionComponent, useCallback, useEffect, useState } from 'react';
import { recordToApex, RecordToApexOptionsInitialOptions } from '../utils/query-apex-utils';
import QueryResultsGetRecAsApexFieldOptions from './QueryResultsGetRecAsApexFieldOptions';
import QueryResultsGetRecAsApexGenerateOptions from './QueryResultsGetRecAsApexGenerateOptions';

export interface QueryResultsGetRecAsApexModalProps {
  org: SalesforceOrgUi;
  record: any;
  sobjectName: string;
  onClose: () => void;
}

export const QueryResultsGetRecAsApexModal: FunctionComponent<QueryResultsGetRecAsApexModalProps> = ({
  org,
  record,
  sobjectName,
  onClose,
}) => {
  const [loading, setLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [fieldMetadata, setFieldMetadata] = useState<Field[]>([]);
  const [fieldTypesByName, setFieldTypesByName] = useState<MapOf<FieldType>>({});
  const [fields, setFields] = useState<string[]>([]);
  const [options, setOptions] = useState<RecordToApexOptionsInitialOptions>({
    sobjectName,
    fieldMetadata: fieldTypesByName,
    fields,
  });
  const [apex, setApex] = useState<string>('');

  const fetchFieldMetadata = useCallback(async () => {
    try {
      setApex('');
      setLoading(true);
      setHasError(false);
      setFieldMetadata([]);
      setFieldTypesByName({});
      const metadata = await describeSObject(org, sobjectName);
      // metadata will include namespace, but when we get the record from Salesforce it will not include the namespace
      if (org.orgNamespacePrefix) {
        const replaceRegex = new RegExp(`^${org.orgNamespacePrefix}__`);
        metadata.data.fields = metadata.data.fields.map((field) => {
          return { ...field, name: field.name.replace(replaceRegex, '') };
        });
      }
      const fieldTypeByApiName = metadata.data.fields.reduce((output: MapOf<FieldType>, field) => {
        const replaceNamespace = org.orgNamespacePrefix ? `${org.orgNamespacePrefix}__` : '';
        output[field.name.replace(replaceNamespace, '')] = field.type;
        return output;
      }, {});
      setLoading(false);
      setFieldMetadata(metadata.data.fields);
      setFieldTypesByName(fieldTypeByApiName);
    } catch (ex) {
      logger.warn('[FETCH METADATA ERROR]', ex);
      setLoading(true);
      setHasError(true);
    }
  }, [org, sobjectName]);

  useEffect(() => {
    fetchFieldMetadata();
  }, [fetchFieldMetadata, org, record, sobjectName]);

  useEffect(() => {
    setOptions((options) => ({ ...options, fieldMetadata: fieldTypesByName }));
  }, [fieldTypesByName]);

  useEffect(() => {
    setOptions((options) => ({ ...options, fields }));
  }, [fields]);

  useNonInitialEffect(() => {
    if (!loading && !hasError) {
      setApex(recordToApex(record, options));
    }
  }, [hasError, loading, options, record]);

  function handleOptionsChange(partialOptions: Partial<RecordToApexOptionsInitialOptions>) {
    setOptions((options) => ({ ...options, ...partialOptions }));
  }

  function handleCopyToClipboard() {
    copyToClipboard(apex, { format: 'text/plain' });
  }

  function handleEditorChange(value, event) {
    setApex(value);
  }

  return (
    <Modal
      header="Turn Record Into Apex"
      size="lg"
      footer={
        <Grid align="end">
          <button className="slds-button slds-button_brand" onClick={() => onClose()} disabled={loading}>
            Close
          </button>
        </Grid>
      }
      onClose={() => onClose()}
    >
      <div
        className="slds-is-relative"
        css={css`
          height: 80vh;
          min-height: 80vh;
          max-height: 80vh;
        `}
      >
        {loading && <Spinner />}
        {!loading && (
          <Grid
            css={css`
              height: 100%;
            `}
          >
            <GridCol size={4}>
              {/* Field Options */}
              <QueryResultsGetRecAsApexFieldOptions
                fieldMetadata={fieldMetadata}
                record={record}
                onFields={(fields) => setFields(fields)}
              />
              {/* Generation Options */}
              <QueryResultsGetRecAsApexGenerateOptions onChange={handleOptionsChange} />
              <hr className="slds-m-vertical_medium" />
              <button className="slds-button slds-button_neutral" onClick={handleCopyToClipboard} disabled={loading}>
                <Icon type="utility" icon="download" className="slds-button__icon slds-button__icon_left" omitContainer />
                Copy to Clipboard
              </button>
            </GridCol>
            <GridCol
              css={css`
                height: 100%;
              `}
            >
              {fields.length > 0 && (
                <Editor
                  height="100%"
                  theme="vs-dark"
                  defaultLanguage="apex"
                  value={apex}
                  options={{ contextmenu: false }}
                  onChange={handleEditorChange}
                />
              )}
              {fields.length === 0 && (
                <EmptyState
                  headline="There are no fields matching your selected options"
                  subHeading="Adjust your field options or your query to include additional fields."
                  illustration={<AxeIllustration />}
                ></EmptyState>
              )}
            </GridCol>
          </Grid>
        )}
      </div>
    </Modal>
  );
};

export default QueryResultsGetRecAsApexModal;
