import { logger } from '@jetstream/shared/client-logger';
import { SFDC_BULK_API_NULL_VALUE } from '@jetstream/shared/constants';
import { queryAll, queryWithCache } from '@jetstream/shared/data';
import { describeSObjectWithExtendedTypes, formatNumber } from '@jetstream/shared/ui-utils';
import { REGEX, transformRecordForDataLoad } from '@jetstream/shared/utils';
import { EntityParticleRecord, FieldWithExtendedType, MapOf, SalesforceOrgUi } from '@jetstream/types';
import { DescribeGlobalSObjectResult } from 'jsforce';
import JSZip from 'jszip';
import groupBy from 'lodash/groupBy';
import isNil from 'lodash/isNil';
import isString from 'lodash/isString';
import { composeQuery, getField, Query, WhereClause } from 'soql-parser-js';
import {
  FieldMapping,
  FieldMappingItem,
  FieldRelatedEntity,
  FieldWithRelatedEntities,
  MapOfCustomMetadataRecord,
  NonExtIdLookupOption,
  PrepareDataPayload,
  PrepareDataResponse,
} from '../load-records-types';

const DEFAULT_NON_EXT_ID_MAPPING_OPT: NonExtIdLookupOption = 'ERROR_IF_MULTIPLE';
const DEFAULT_NULL_IF_NO_MATCH_MAPPING_OPT = false;

export class LoadRecordsBatchError extends Error {
  additionalErrors: Error[];
  constructor(message: string, additionalErrors?: Error[]) {
    super(`${message}. ${additionalErrors ? additionalErrors.map((ex) => ex.message).join(', ') : ''}`.trim());
    this.additionalErrors = additionalErrors || [];
  }
}

export function filterLoadSobjects(sobject: DescribeGlobalSObjectResult) {
  return (
    (sobject.createable || sobject.updateable || sobject.name.endsWith('__mdt')) &&
    !sobject.name.endsWith('__History') &&
    !sobject.name.endsWith('__Tag') &&
    !sobject.name.endsWith('__Feed')
  );
}

export const getFieldMetadataFilter = (field: FieldWithExtendedType) => field.createable || field.updateable || field.name === 'Id';
// Custom metadata shows all fields as read-only, but we want to be able to update them
export const getFieldMetadataCustomMetadataFilter = (field: FieldWithExtendedType) =>
  field.custom || field.name === 'DeveloperName' || field.name === 'Label';

export async function getFieldMetadata(org: SalesforceOrgUi, sobject: string): Promise<FieldWithRelatedEntities[]> {
  const fields = (await describeSObjectWithExtendedTypes(org, sobject)).fields
    .filter(sobject.endsWith('__mdt') ? getFieldMetadataCustomMetadataFilter : getFieldMetadataFilter)
    .map((field): FieldWithRelatedEntities => {
      let referenceTo =
        (field.type === 'reference' && field.referenceTo.slice(0, 5 /** Limit number of related object to limit query */)) || undefined;
      // if only two polymorphic fields exist and the second is user, reverse the order so that User is first as it is most commonly used
      if (Array.isArray(referenceTo) && referenceTo.length === 2 && referenceTo[1] === 'User') {
        referenceTo = referenceTo.reverse();
      }
      return {
        label: field.label,
        name: field.name,
        type: field.type,
        soapType: field.soapType,
        externalId: field.externalId,
        typeLabel: field.typeLabel,
        referenceTo,
        relationshipName: field.relationshipName || undefined,
      };
    });

  // fetch all related fields
  const fieldsWithRelationships = fields.filter((field) => Array.isArray(field.referenceTo) && field.referenceTo.length);
  const relatedObjects = new Set(fieldsWithRelationships.flatMap((field) => field.referenceTo));
  // related records
  if (relatedObjects.size > 0) {
    const relatedEntities = (
      await queryWithCache<EntityParticleRecord>(org, getExternalIdFieldsForSobjectsQuery(Array.from(relatedObjects)), true)
    ).data;
    const relatedEntitiesByObj = groupBy(relatedEntities.queryResults.records, 'EntityDefinition.QualifiedApiName');
    fieldsWithRelationships.forEach((field) => {
      if (Array.isArray(field.referenceTo)) {
        field.referenceTo.forEach((referenceTo) => {
          const relatedFields = relatedEntitiesByObj[referenceTo];
          if (relatedFields) {
            field.relatedFields = field.relatedFields || {};
            field.relatedFields[referenceTo] = relatedFields.map(
              (particle): FieldRelatedEntity => ({
                name: particle.Name,
                label: particle.Label,
                type: particle.DataType,
                isExternalId: particle.IsIdLookup,
              })
            );
          }
        });
      }
    });
  }
  return fields;
}

/**
 * Attempt to auto-match CSV fields to object fields
 * 1. exact API name match
 * 2. lowercase match
 * 3. match without any special characters
 *
 * If field has a "." then an auto-match against the related fields are attempted using steps 1 and 2 from above
 *
 * @param inputHeader
 * @param fields
 */
export function autoMapFields(inputHeader: string[], fields: FieldWithRelatedEntities[], binaryBodyField: string): FieldMapping {
  const output: FieldMapping = {};
  const fieldVariations: MapOf<FieldWithRelatedEntities> = {};
  const fieldLabelVariations: MapOf<FieldWithRelatedEntities> = {};

  // create versions of field that can be used to match back to original field
  fields.forEach((field) => {
    fieldVariations[field.name] = field;
    const lowercase = field.name.toLowerCase();
    fieldVariations[lowercase] = field;
    if (isString(field.relationshipName)) {
      fieldVariations[field.relationshipName] = field;
      fieldVariations[field.relationshipName.toLowerCase()] = field;
    }
    fieldVariations[lowercase.replace(REGEX.NOT_ALPHANUMERIC, '')] = field;

    // label takes second priority to api name
    fieldLabelVariations[field.label] = field;
    const lowercaseLabel = field.label.toLowerCase();
    fieldLabelVariations[lowercaseLabel] = field;
    fieldLabelVariations[lowercaseLabel.replace(REGEX.NOT_ALPHANUMERIC, '')] = field;
  });

  inputHeader.forEach((field) => {
    const [baseFieldOrRelationship, relatedField] = field.split('.');
    const lowercaseFieldOrRelationship = baseFieldOrRelationship.toLowerCase();
    const matchedField =
      /** Match Against Api name or full path with api name */
      fieldVariations[baseFieldOrRelationship] ||
      fieldVariations[lowercaseFieldOrRelationship] ||
      fieldVariations[lowercaseFieldOrRelationship.replace(REGEX.NOT_ALPHANUMERIC, '')] ||
      /** Match Against Label (relationship fields are not considered) */
      fieldLabelVariations[baseFieldOrRelationship] ||
      fieldLabelVariations[lowercaseFieldOrRelationship] ||
      fieldLabelVariations[lowercaseFieldOrRelationship.replace(REGEX.NOT_ALPHANUMERIC, '')];

    output[field] = {
      csvField: field,
      targetField: matchedField?.name || null,
      mappedToLookup: false,
      fieldMetadata: matchedField,
      lookupOptionUseFirstMatch: DEFAULT_NON_EXT_ID_MAPPING_OPT,
      lookupOptionNullIfNoMatch: DEFAULT_NULL_IF_NO_MATCH_MAPPING_OPT,
      isBinaryBodyField: !!binaryBodyField && matchedField?.name === binaryBodyField,
    };

    if (relatedField && matchedField && matchedField.relatedFields) {
      // search all related object fields to see if related field matches
      const { relatedObject, matchedRelatedField } = Object.keys(matchedField.relatedFields).reduce(
        (output: { relatedObject: string; matchedRelatedField: FieldRelatedEntity }, key) => {
          // if we found a prior match, stop checking
          if (output.matchedRelatedField) {
            return output;
          }
          // find if current related object has field by same related name
          const matchedRelatedField = matchedField.relatedFields[key].find(
            (relatedEntityField) =>
              relatedField === relatedEntityField.name || relatedField.toLowerCase() === relatedEntityField.name.toLowerCase()
          );
          if (matchedRelatedField) {
            output = { relatedObject: key, matchedRelatedField };
          }
          return output;
        },
        { relatedObject: undefined, matchedRelatedField: undefined }
      );

      if (matchedRelatedField) {
        output[field].mappedToLookup = true;
        output[field].targetLookupField = matchedRelatedField.name;
        output[field].relationshipName = matchedField.relationshipName;
        output[field].fieldMetadata = matchedField;
        output[field].relatedFieldMetadata = matchedRelatedField;
        output[field].selectedReferenceTo = relatedObject;
      } else {
        output[field].targetField = null;
        output[field].fieldMetadata = undefined;
      }
    }
  });

  return checkForDuplicateFieldMappings(output);
}

export function resetFieldMapping(inputHeader: string[]): FieldMapping {
  return inputHeader.reduce((output: FieldMapping, field) => {
    output[field] = {
      csvField: field,
      targetField: null,
      mappedToLookup: false,
      fieldMetadata: undefined,
      selectedReferenceTo: undefined,
      lookupOptionUseFirstMatch: DEFAULT_NON_EXT_ID_MAPPING_OPT,
      lookupOptionNullIfNoMatch: DEFAULT_NULL_IF_NO_MATCH_MAPPING_OPT,
      isBinaryBodyField: false,
    };
    return output;
  }, {});
}

export function checkForDuplicateFieldMappings(fieldMapping: FieldMapping): FieldMapping {
  fieldMapping = { ...fieldMapping };
  const mappedFieldFrequency = Object.values(fieldMapping)
    .filter((field) => !!field.targetField)
    .reduce((output: MapOf<number>, field) => {
      output[field.targetField] = output[field.targetField] || 0;
      output[field.targetField] += 1;
      return output;
    }, {});
  Object.keys(fieldMapping).forEach((key) => {
    if (fieldMapping[key].targetField) {
      fieldMapping[key] = { ...fieldMapping[key], isDuplicateMappedField: mappedFieldFrequency[fieldMapping[key].targetField] > 1 };
    } else {
      fieldMapping[key] = { ...fieldMapping[key], isDuplicateMappedField: false };
    }
  });
  return fieldMapping;
}

function getExternalIdFieldsForSobjectsQuery(sobjects: string[]) {
  const soql = composeQuery({
    fields: [
      getField('Id'),
      getField('Name'),
      getField('EntityDefinitionId'),
      getField('EntityDefinition.QualifiedApiName'),
      getField('IsIdLookup'),
      getField('DataType'),
      getField('ValueTypeId'),
      getField('ReferenceTo'),
      getField('IsCreatable'),
      getField('IsUpdatable'),
      getField('Label'),
      getField('MasterLabel'),
      getField('QualifiedApiName'),
      getField('RelationshipName'),
    ],
    sObject: 'EntityParticle',
    where: {
      left: {
        field: 'EntityDefinition.QualifiedApiName',
        operator: 'IN',
        value: sobjects,
        literalType: 'STRING',
      },
      operator: 'AND',
      right: {
        left: {
          field: 'QualifiedApiName',
          operator: '!=',
          value: 'Id',
          literalType: 'STRING',
        },
        operator: 'AND',
        right: {
          left: {
            field: 'DataType',
            operator: 'IN',
            value: ['string', 'phone', 'url', 'email'],
            literalType: 'STRING',
          },
        },
      },
    },
    orderBy: [
      {
        field: 'EntityDefinitionId',
      },
      { field: 'Label' },
    ],
  });
  logger.info('getExternalIdFieldsForSobjectsQuery()', { soql });
  return soql;
}

export function getFieldHeaderFromMapping(fieldMapping: FieldMapping) {
  return Object.values(fieldMapping)
    .filter((item) => !!item.targetField)
    .map((item) => {
      let output = item.targetField;
      if (item.mappedToLookup && item.targetLookupField && item.relatedFieldMetadata?.isExternalId) {
        output = `${item.relationshipName}.${item.targetLookupField}`;
      }
      return output;
    });
}

export function transformData({ data, fieldMapping, sObject, insertNulls, dateFormat, apiMode }: PrepareDataPayload): any[] {
  return data.map((row) => {
    return Object.keys(fieldMapping)
      .filter((key) => !!fieldMapping[key].targetField)
      .reduce((output: any, field, i) => {
        if (apiMode === 'BATCH' && i === 0) {
          output.attributes = { type: sObject };
        }
        let skipField = false;
        const fieldMappingItem = fieldMapping[field];
        // SFDC handles automatic type conversion with both bulk and batch apis (if possible, otherwise the record errors)
        let value = row[field];

        if (isNil(value) || (isString(value) && !value)) {
          if (apiMode === 'BULK' && insertNulls) {
            value = SFDC_BULK_API_NULL_VALUE;
          } else if (apiMode === 'BATCH' && insertNulls) {
            value = null;
          } else if (apiMode === 'BATCH') {
            // batch api will always clear the value in SFDC if a null is passed, so we must ensure it is not included at all
            skipField = true;
          }
        } else {
          value = transformRecordForDataLoad(value, fieldMappingItem.fieldMetadata.type, dateFormat);
        }

        if (!skipField) {
          // Handle external Id related fields
          // Non-external Id lookups are handled separately in `fetchMappedRelatedRecords()` and are mapped normally to the target field initially
          if (
            apiMode === 'BATCH' &&
            fieldMappingItem.mappedToLookup &&
            fieldMappingItem.relatedFieldMetadata?.isExternalId &&
            fieldMappingItem.targetLookupField
          ) {
            output[fieldMappingItem.relationshipName] = { [fieldMappingItem.targetLookupField]: value };
            // if polymorphic field, then add type attribute
            if (fieldMappingItem.fieldMetadata?.referenceTo?.length > 1) {
              output[fieldMappingItem.relationshipName] = {
                attributes: { type: fieldMappingItem.selectedReferenceTo },
                ...output[fieldMappingItem.relationshipName],
              };
            }
          } else if (
            fieldMappingItem.mappedToLookup &&
            fieldMappingItem.relatedFieldMetadata?.isExternalId &&
            fieldMappingItem.targetLookupField
          ) {
            if (fieldMappingItem.fieldMetadata?.referenceTo?.length > 1) {
              // add in polymorphic field type
              // https://developer.salesforce.com/docs/atlas.en-us.api_asynch.meta/api_asynch/datafiles_csv_rel_field_header_row.htm?search_text=Polymorphic
              output[`${fieldMappingItem.selectedReferenceTo}:${fieldMappingItem.relationshipName}.${fieldMappingItem.targetLookupField}`] =
                value;
            } else {
              output[`${fieldMappingItem.relationshipName}.${fieldMappingItem.targetLookupField}`] = value;
            }
          } else {
            output[fieldMappingItem.targetField] = value;
          }
        }

        return output;
      }, {});
  });
}

/**
 * For any lookup fields that are not mapped to an external Id, fetch related records and populate related record Id for each field
 * The fieldMapping option contains the options the user selected on how to handle cases where 0 or multiple related records are found for a given value
 *
 * @param data records
 * @param param1
 * @returns
 */
export async function fetchMappedRelatedRecords(
  data: any,
  { org, sObject, fieldMapping, apiMode }: PrepareDataPayload,
  onProgress: (progress: number) => void
): Promise<PrepareDataResponse> {
  const nonExternalIdFieldMappings = Object.values(fieldMapping).filter(
    (item) => item.mappedToLookup && item.relatedFieldMetadata && !item.relatedFieldMetadata.isExternalId
  );

  const queryErrors: string[] = [];
  const errorsByRowIndex = new Map<number, { row: number; record: any; errors: string[] }>();
  const addError = addErrors(errorsByRowIndex);

  if (nonExternalIdFieldMappings.length) {
    // progress indicator
    let current = 0;
    const step = 100 / nonExternalIdFieldMappings.length;
    const total = 100;

    // increment progress between current and next step - lots of incremental records queried
    const emitQueryProgress = (currentQuery: number, total: number) => {
      const progressIncrement = (currentQuery / total) * step;
      // ensure we don't exceed beyond the current step
      onProgress(Math.min(current + progressIncrement, current + step));
    };

    for (const {
      lookupOptionNullIfNoMatch,
      lookupOptionUseFirstMatch,
      relationshipName,
      selectedReferenceTo,
      targetField,
      targetLookupField,
    } of nonExternalIdFieldMappings) {
      onProgress(Math.min(current / total, 100));
      const fieldRelationshipName = `${relationshipName}.${targetLookupField}`;
      // remove any falsy values, related fields cannot be booleans or numbers, so this should not cause issues
      const relatedValues = new Set<string>(data.map((row) => row[targetField]).filter(Boolean));

      if (relatedValues.size) {
        const relatedRecordsByRelatedField: MapOf<string[]> = {};
        // Get as many queries as required based on the size of the related fields
        const queries = getRelatedFieldsQueries(sObject, selectedReferenceTo, targetLookupField, Array.from(relatedValues));
        let currentQuery = 1;
        for (const query of queries) {
          try {
            emitQueryProgress(currentQuery, queries.length);
            currentQuery++;
            (await queryAll(org, query)).queryResults.records.forEach((record) => {
              relatedRecordsByRelatedField[record[targetLookupField]] = relatedRecordsByRelatedField[record[targetLookupField]] || [];
              relatedRecordsByRelatedField[record[targetLookupField]].push(record.Id);
            });
          } catch (ex) {
            queryErrors.push(ex.message);
          }
        }

        data.forEach((record, i) => {
          if (isNil(record[targetField]) || record[targetField] === '') {
            return;
          }
          const relatedRecords = relatedRecordsByRelatedField[record[targetField]];
          /** NO RELATED RECORD FOUND */
          if (!relatedRecords) {
            if (lookupOptionNullIfNoMatch) {
              record[targetField] = apiMode === 'BATCH' ? null : SFDC_BULK_API_NULL_VALUE;
            } else {
              // No match, and not mark as null
              addError(
                i,
                record,
                `Related record not found for relationship "${fieldRelationshipName}" with a value of "${record[targetField]}".`
              );
            }
          } else if (relatedRecords.length > 1 && lookupOptionUseFirstMatch !== 'FIRST') {
            addError(
              i,
              record,
              `Found ${formatNumber(relatedRecords.length)} related records for relationship "${fieldRelationshipName}" with a value of "${
                record[targetField]
              }".`
            );
          } else {
            /** FOUND 1 MATCH, OR OPTION TO USE FIRST MATCH */
            record[targetField] = relatedRecords[0];
          }
        });
      }
      current++;
    }
    onProgress(100);
  }
  // remove failed records from dataset
  data = data.filter((_, i: number) => !errorsByRowIndex.has(i));

  return { data, errors: Array.from(errorsByRowIndex.values()), queryErrors };
}

function addErrors(errorsByRowIndex: Map<number, { row: number; record: any; errors: string[] }>) {
  return function addError(row: number, record: any, error: string) {
    if (!errorsByRowIndex.has(row)) {
      errorsByRowIndex.set(row, { row, record, errors: [] });
    }
    errorsByRowIndex.get(row).errors.push(error);
  };
}

/**
 * Get as many queries as required to fetch all the related values based on the length of the query
 *
 * @param baseObject Parent object, not the one being queried - used for additional filter special cases (e.x. RecordType)
 * @param relatedObject
 * @param relatedField
 * @param relatedValues
 * @returns
 */
function getRelatedFieldsQueries(baseObject: string, relatedObject: string, relatedField: string, relatedValues: string[]): string[] {
  let extraWhereClause = '';

  const baseQuery: Query = {
    sObject: relatedObject,
    fields: Array.from(new Set([getField('Id'), getField(relatedField)])),
  };

  let extraWhereClauseNew: WhereClause;
  const whereClause: WhereClause = {
    left: {
      field: relatedField,
      operator: 'IN',
      value: [],
      literalType: 'STRING',
    },
  };

  /** SPECIAL CASES */
  if (relatedObject.toLowerCase() === 'recordtype') {
    extraWhereClause = `SobjectType = '${baseObject}' AND `;
    extraWhereClauseNew = {
      left: {
        field: 'SobjectType',
        operator: '=',
        value: baseObject,
        literalType: 'STRING',
      },
    };
  }
  const QUERY_ITEM_BUFFER_LENGTH = 250;
  const BASE_QUERY_LENGTH =
    `SELECT Id, ${relatedField} FROM ${relatedObject} WHERE ${extraWhereClause}${relatedField} IN ('`.length + QUERY_ITEM_BUFFER_LENGTH;
  const MAX_QUERY_LENGTH = 9500; // somewhere just over 10K was giving an error

  const queries = [];
  let tempRelatedValues: string[] = [];
  let currLength = BASE_QUERY_LENGTH;
  relatedValues.forEach((value) => {
    tempRelatedValues.push(value.replaceAll(`'`, `\\'`).replaceAll(`\\n`, `\\\\n`));
    currLength += value.length + QUERY_ITEM_BUFFER_LENGTH;
    if (currLength >= MAX_QUERY_LENGTH) {
      const tempQuery = { ...baseQuery };
      if (extraWhereClauseNew) {
        tempQuery.where = {
          ...extraWhereClauseNew,
          operator: 'AND',
          right: { ...whereClause, left: { ...whereClause.left, value: tempRelatedValues } },
        };
      } else {
        tempQuery.where = { ...whereClause, left: { ...whereClause.left, value: tempRelatedValues } };
      }
      queries.push(composeQuery(tempQuery));
      tempRelatedValues = [];
      currLength = BASE_QUERY_LENGTH;
    }
  });
  if (tempRelatedValues.length) {
    const tempQuery = { ...baseQuery };
    if (extraWhereClauseNew) {
      tempQuery.where = {
        ...extraWhereClauseNew,
        operator: 'AND',
        right: { ...whereClause, left: { ...whereClause.left, value: tempRelatedValues } },
      };
    } else {
      tempQuery.where = { ...whereClause, left: { ...whereClause.left, value: tempRelatedValues } };
    }
    queries.push(composeQuery(tempQuery));
  }
  return queries;
}

/**
 * Used for loading custom metadata records
 */
export function convertCsvToCustomMetadata(
  selectedSObject: string,
  inputFileData: any[],
  fields: FieldWithRelatedEntities[],
  fieldMapping: FieldMapping,
  dateFormat?: string
): MapOfCustomMetadataRecord {
  const metadataByFullName: MapOfCustomMetadataRecord = {};

  selectedSObject = selectedSObject.replace('__mdt', '');
  const fieldMappingByTargetField: MapOf<FieldMappingItem> = Object.values(fieldMapping)
    .filter((field) => field.targetField)
    .reduce((output, field) => {
      output[field.targetField] = field;
      return output;
    }, {});

  inputFileData.forEach((row) => {
    const fullName = `${selectedSObject}.${row[fieldMappingByTargetField.DeveloperName.csvField]}`;
    const label = fieldMappingByTargetField.Label ? row[fieldMappingByTargetField.Label.csvField] : null;
    const record: any = {
      DeveloperName: fullName,
      Label: label,
    };
    let metadata = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    metadata += `<CustomMetadata xmlns="http://soap.sforce.com/2006/04/metadata" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n`;
    if (label) {
      metadata += `\t<label>${label}</label>\n`;
    }
    metadata += `\t<protected>false</protected>\n`;
    fields
      .filter((field) => field.name.endsWith('__c'))
      .forEach((field) => {
        const fieldMappingItem = fieldMappingByTargetField[field.name];
        let fieldValue = fieldMappingItem ? row[fieldMappingItem.csvField] : null;
        // ensure that field is in correct data type (mostly for dates)
        fieldValue = transformRecordForDataLoad(fieldValue, field.type, dateFormat);
        // Custom metadata lookups always use name to relate records
        const soapType = field.soapType === 'tns:ID' ? 'xsd:string' : field.soapType;
        if (fieldMappingItem && !isNil(fieldValue) && fieldValue !== '') {
          metadata += `\t<values>\n`;
          metadata += `\t\t<field>${field.name}</field>\n`;
          metadata += `\t\t<value xsi:type="${soapType}">${fieldValue}</value>\n`;
          metadata += `\t</values>\n`;
          record[field.name] = fieldValue;
        } else {
          metadata += `\t<values>\n`;
          metadata += `\t\t<field>${field.name}</field>\n`;
          metadata += `\t\t<value xsi:nil="true"/>\n`;
          metadata += `\t</values>\n`;
          record[field.name] = null;
        }
      });
    metadata += `</CustomMetadata>`;

    metadataByFullName[fullName] = {
      record,
      fullName,
      metadata,
    };
  });
  logger.log({ metadataByFullName });
  return metadataByFullName;
}
export function prepareCustomMetadata(apiVersion, metadata: MapOfCustomMetadataRecord): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    'package.xml',
    [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<Package xmlns="http://soap.sforce.com/2006/04/metadata">`,
      `\t<types>`,
      ...Object.keys(metadata).map((fullName) => `\t\t<members>${fullName}</members>`),
      `\t\t<name>CustomMetadata</name>`,
      `\t</types>`,
      `\t<version>${apiVersion.replace('v', '')}</version>`,
      `</Package>`,
    ].join('\n')
  );
  Object.keys(metadata).forEach((fullName) => {
    zip.file(`customMetadata/${fullName}.md`, metadata[fullName].metadata);
  });
  return zip.generateAsync({ type: 'arraybuffer' });
}
