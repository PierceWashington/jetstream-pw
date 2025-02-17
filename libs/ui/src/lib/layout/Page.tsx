import { jsx, css } from '@emotion/react';
import { FunctionComponent } from 'react';

export interface PageProps {
  className?: string;
  children?: React.ReactNode;
}

export const Page: FunctionComponent<PageProps> = ({ className, children }) => {
  return (
    <div
      className={`slds-card slds-card_boundary slds-grid slds-grid--vertical ${className || ''}`}
      css={css`
        height: 100%;
      `}
      data-testid="page"
    >
      {/* Callee should include a PageHeader and then the page content as children */}
      {children}
    </div>
  );
};

export default Page;
