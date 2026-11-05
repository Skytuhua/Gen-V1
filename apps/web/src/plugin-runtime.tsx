/** Public presentation runtime. Loaded only inside the isolated plug-in frame. */
import './plugin-validation-policy';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import * as JSXRuntime from 'react/jsx-runtime';
export {React,ReactDOM,ReactDOMClient,JSXRuntime};
export {ComposerView} from './ComposerView';
export {ArtifactFrame,ArtifactPresentation} from './ArtifactPresentation';
export {Markdown} from './Markdown';
export {InboxView} from './InboxView';
export {PluginFloatingWindow as FloatingWindow} from './PluginFloatingWindow';
export * from './plugin-frame-client';
export {registerPlugin} from '../../../packages/plugins/frontend';
export {WorkspaceSplitLayout} from './WorkspaceSplitLayout';
import {createSplitWorkspaceLayout,applySplitWorkspaceCommand} from '../../../packages/core/split-workspace-layout';
import {splitWorkspaceLayoutSchema} from '../../../packages/contracts/split-workspace';
/** Pure layout presentation only. Private journals retain their own custody. */
export const splitWorkspace={create:createSplitWorkspaceLayout,apply:applySplitWorkspaceCommand,parse:(value:unknown)=>splitWorkspaceLayoutSchema.parse(value)};
import '@fontsource-variable/inter';
import './styles.css';
import './frontend-fidelity.css';
import './shell.css';
