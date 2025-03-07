import React from 'react';
import type { LayoutComponent } from 'react-admin';
import { Layout } from 'react-admin';
import { TailchatMenu } from './Menu';

export const TailchatLayout: LayoutComponent = (props) => (
  <Layout {...props} menu={TailchatMenu} />
);
