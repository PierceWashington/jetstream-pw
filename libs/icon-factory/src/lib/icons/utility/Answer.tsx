import * as React from 'react';

function SvgAnswer(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 52 52" aria-hidden="true" {...props}>
      <path
        fill="unset"
        d="M26 4C12.7 4 2 13.8 2 26c0 3.9 1.1 7.5 3 10.8.2.4.3.9.2 1.3L3 45c-.4 1.3.8 2.4 2.1 2l7-2.4c.5-.2 1-.1 1.4.2 3.7 2.1 8 3.3 12.6 3.3 13.3 0 24-9.8 24-22C49.9 13.8 39.2 4 26 4zm11.5 17.1l-12.2 12c-.5.5-1 .7-1.7.7-.6 0-1.2-.2-1.7-.7L16 27.3c-.5-.5-.5-1.2 0-1.6l1.7-1.6c.5-.5 1.2-.5 1.7 0l4.2 4.2 10.5-10.4c.5-.5 1.2-.5 1.7 0l1.7 1.6c.4.4.4 1.2 0 1.6z"
      />
    </svg>
  );
}

export default SvgAnswer;
