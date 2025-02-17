import * as React from 'react';

function SvgWebcart(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" {...props}>
      <g fill="unset">
        <path d="M42.4 50h29.5c.9 0 1.7-.6 1.9-1.5l5.4-19c.4-1.3-.6-2.5-1.9-2.5H31.7l-.8-2.8c-.4-1.3-1.6-2.2-2.9-2.2h-4.8c-1.6 0-3.1 1.2-3.2 2.8-.1 1.7 1.3 3.2 3 3.2h2.8l9.4 31.8c.4 1.3 1.5 2.2 2.9 2.2h34.8c1.6 0 3.1-1.2 3.2-2.8.1-1.7-1.3-3.2-3-3.2H42.5c-1.3 0-2.5-.9-2.8-2.1v-.1c-.7-1.9.8-3.8 2.7-3.8z" />
        <circle cx={43} cy={73} r={5} />
        <circle cx={67} cy={73} r={5} />
      </g>
    </svg>
  );
}

export default SvgWebcart;
