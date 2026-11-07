import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ArtifactFrame } from '../apps/web/src/ArtifactPresentation';
import { ProjectContextCard } from '../apps/web/src/ProjectContextCard';

it('omits a falsy artifact tools slot without inserting a raw zero in the header', () => {
  const html = renderToStaticMarkup(createElement(ArtifactFrame, { title: 'Report', tools: 0, children: 'Body' }));
  expect(html).not.toContain('</span>0</header>');
  expect(html).toContain('</span></header>');
  expect(html).toContain('Body');
});

it('omits a falsy project plan slot without inserting a raw zero after the overview', () => {
  const html = renderToStaticMarkup(createElement(ProjectContextCard, { threadTitle: 'Conversation', plan: 0 }));
  expect(html).not.toContain('0</div>');
  expect(html).toContain('Conversation');
});
