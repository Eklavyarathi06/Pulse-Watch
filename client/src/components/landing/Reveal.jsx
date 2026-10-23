import React, { Children, isValidElement, cloneElement } from 'react';

/**
 * Splits text children into words wrapped in overflow masks so GSAP can raise
 * them line by line ([data-reveal] is picked up by the Landing scroll setup).
 * Inline elements (e.g. a serif italic span) are kept intact as one unit.
 */
export function SplitWords({ children, className, as: Tag = 'span' }) {
  let i = 0;
  const wrap = (node) => {
    if (typeof node === 'string') {
      return node.split(/(\s+)/).map((part) => {
        if (/^\s+$/.test(part) || part === '') return part;
        const key = i++;
        return (
          <span key={key} className="inline-block overflow-hidden pb-[0.08em] align-bottom">
            <span data-word className="inline-block will-change-transform">{part}</span>
          </span>
        );
      });
    }
    if (isValidElement(node)) {
      if (node.type === 'br') return node;
      const key = i++;
      return (
        <span key={key} className="inline-block overflow-hidden pb-[0.08em] align-bottom">
          <span data-word className="inline-block will-change-transform">
            {cloneElement(node)}
          </span>
        </span>
      );
    }
    return node;
  };

  return (
    <Tag className={className} data-reveal>
      {Children.map(children, wrap)}
    </Tag>
  );
}
