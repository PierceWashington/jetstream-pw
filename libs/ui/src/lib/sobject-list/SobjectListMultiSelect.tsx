import { css } from '@emotion/react';
import { formatNumber } from '@jetstream/shared/ui-utils';
import { multiWordObjectFilter, orderStringsBy } from '@jetstream/shared/utils';
import { Maybe, UpDown } from '@jetstream/types';
import type { DescribeGlobalSObjectResult } from 'jsforce';
import { createRef, Fragment, FunctionComponent, useEffect, useState } from 'react';
import Checkbox from '../form/checkbox/Checkbox';
import SearchInput from '../form/search-input/SearchInput';
import EmptyState from '../illustrations/EmptyState';
import AutoFullHeightContainer from '../layout/AutoFullHeightContainer';
import List from '../list/List';
import ItemSelectionSummary from '../widgets/ItemSelectionSummary';
import Spinner from '../widgets/Spinner';

export interface SobjectListMultiSelectProps {
  sobjects: Maybe<DescribeGlobalSObjectResult[]>;
  selectedSObjects: string[];
  allowSelectAll?: boolean;
  disabled?: boolean;
  loading: boolean;
  errorMessage?: Maybe<string>;
  onSelected: (selectedSObjects: string[]) => void;
  errorReattempt: () => void;
}

export const SobjectListMultiSelect: FunctionComponent<SobjectListMultiSelectProps> = ({
  sobjects,
  selectedSObjects = [],
  allowSelectAll = true,
  disabled = false, // TODO:
  loading,
  errorMessage,
  onSelected,
  errorReattempt,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredSobjects, setFilteredSobjects] = useState<Maybe<DescribeGlobalSObjectResult[]>>(() => {
    if (sobjects && sobjects?.length > 0 && searchTerm) {
      return sobjects.filter(multiWordObjectFilter(['name', 'label'], searchTerm));
    } else {
      return sobjects;
    }
  });
  const [selectedSObjectSet, setSelectedSObjectSet] = useState<Set<string>>(new Set<string>(selectedSObjects || []));
  const [searchInputId] = useState(`object-filter-${Date.now()}`);
  const ulRef = createRef<HTMLUListElement>();

  useEffect(() => {
    if (sobjects && sobjects.length > 0 && searchTerm) {
      setFilteredSobjects(sobjects.filter(multiWordObjectFilter(['name', 'label'], searchTerm)));
    } else {
      setFilteredSobjects(sobjects);
    }
  }, [sobjects, searchTerm]);

  useEffect(() => {
    setSelectedSObjectSet(new Set<string>(selectedSObjects || []));
  }, [selectedSObjects]);

  function handleSearchKeyboard(direction: UpDown) {
    if (ulRef && ulRef.current) {
      ulRef.current.focus();
    }
  }

  function handleSelection(sobjectName: string) {
    if (selectedSObjectSet.has(sobjectName)) {
      selectedSObjectSet.delete(sobjectName);
      onSelected(Array.from(selectedSObjectSet));
    } else {
      onSelected(orderStringsBy(Array.from(selectedSObjectSet).concat(sobjectName)));
    }
  }

  function handleSelectAll(value: boolean) {
    filteredSobjects?.forEach((item) => {
      if (value) {
        selectedSObjectSet.add(item.name);
      } else {
        selectedSObjectSet.delete(item.name);
      }
    });
    onSelected(orderStringsBy(Array.from(selectedSObjectSet)));
  }

  return (
    <Fragment>
      {loading && !sobjects && (
        <div
          className="slds-is-relative"
          css={css`
            min-height: 50px;
          `}
        >
          <Spinner />
        </div>
      )}
      <div>
        {errorMessage && (
          <p className="slds-p-around_medium slds-text-align_center">
            <span className="slds-text-color_error">There was an error loading objects for the selected org.</span>
            <button className="slds-button slds-m-left_xx-small" onClick={() => errorReattempt()}>
              Try Again?
            </button>
          </p>
        )}
        {sobjects && filteredSobjects && (
          <Fragment>
            <div className="slds-p-bottom--xx-small">
              <SearchInput
                id={searchInputId}
                placeholder="Filter Objects"
                onChange={setSearchTerm}
                onArrowKeyUpDown={handleSearchKeyboard}
              />
              <div className="slds-text-body_small slds-text-color_weak slds-p-left--xx-small">
                Showing {formatNumber(filteredSobjects.length)} of {formatNumber(sobjects.length)} objects
              </div>
              {allowSelectAll && (
                <div className="slds-text-body_small slds-text-color_weak slds-p-left--xx-small">
                  <Checkbox
                    id="select-all-sobject-multi"
                    checked={
                      filteredSobjects.length !== 0 &&
                      selectedSObjectSet.size >= filteredSobjects.length &&
                      filteredSobjects.every((item) => selectedSObjectSet.has(item.name))
                    }
                    label="Select All"
                    onChange={handleSelectAll}
                    disabled={filteredSobjects.length === 0}
                  />
                  <ItemSelectionSummary
                    label="object"
                    items={Array.from(selectedSObjectSet).map((item) => ({ label: item, value: item }))}
                    onClearAll={() => onSelected([])}
                    onClearItem={handleSelection}
                  />
                </div>
              )}
            </div>
            <AutoFullHeightContainer bottomBuffer={25}>
              <List
                ref={ulRef}
                items={filteredSobjects}
                isMultiSelect
                isActive={(item: DescribeGlobalSObjectResult) => selectedSObjectSet.has(item.name)}
                onSelected={handleSelection}
                getContent={(item: DescribeGlobalSObjectResult) => ({
                  key: item.name,
                  testId: item.name,
                  heading: item.label,
                  subheading: item.name,
                })}
                searchTerm={searchTerm}
                highlightText
              />
              {!filteredSobjects.length && (
                <EmptyState headline="There are no matching objects" subHeading="Adjust your selection."></EmptyState>
              )}
            </AutoFullHeightContainer>
          </Fragment>
        )}
      </div>
    </Fragment>
  );
};

export default SobjectListMultiSelect;
