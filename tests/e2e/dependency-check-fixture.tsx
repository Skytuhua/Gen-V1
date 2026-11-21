import { createRoot } from 'react-dom/client';
import { DependencyCheckCard } from '../../apps/web/src/DependencyCheckCard';
import '@fontsource-variable/inter';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/dependency-check.css';

const query = new URLSearchParams(location.search);
createRoot(document.getElementById('root')!).render(
  <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
    <DependencyCheckCard threadId={query.get('thread') ?? 't1'} projectId={query.get('project') ?? 'p1'} />
  </div>,
);
