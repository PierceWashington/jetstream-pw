import * as React from 'react';

function SvgLetterhead(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" {...props}>
      <path
        fill="unset"
        d="M73.8 20H26.2c-3.4 0-6.2 2.8-6.2 6.2v47.6c0 3.4 2.8 6.2 6.2 6.2h47.6c3.4 0 6.2-2.8 6.2-6.2V26.2c0-3.4-2.8-6.2-6.2-6.2zM71 69.1c0 .8-.8 1.4-1.6 1.4H30.5c-.8 0-1.4-.8-1.4-1.6v-9c0-.8.8-1.4 1.6-1.4h38.9c.8 0 1.4.8 1.4 1.6v9zm0-29.2c0 .8-.8 1.4-1.6 1.4H30.5c-.8 0-1.4-.8-1.4-1.6v-9c0-.8.8-1.4 1.6-1.4h38.9c.8 0 1.4.8 1.4 1.6v9z"
      />
    </svg>
  );
}

export default SvgLetterhead;
