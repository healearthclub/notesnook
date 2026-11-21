/*
This file is part of the Notesnook project (https://notesnook.com/)

Copyright (C) 2023 Streetwriters (Private) Limited

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/
import React, { PropsWithChildren, ReactElement } from "react";
import { View } from "react-native";
import { Header } from "../../components/header";
import { presentNotesNavigationSheet } from "../../components/side-menu/navigation-sheet";
import { usesNotesTabLayout } from "./list-route";

type ListLayoutProps = PropsWithChildren<{
  header: ReactElement<React.ComponentProps<typeof Header>>;
}>;

export const NotesToolbarAccessory = React.createContext<React.ReactNode>(null);

export function NotesListLayout({ header, children }: ListLayoutProps) {
  const toolbarAccessory = React.useContext(NotesToolbarAccessory);
  if (!usesNotesTabLayout(header.props.renderedInRoute)) {
    return (
      <>
        {header}
        {children}
      </>
    );
  }

  return (
    <>
      <View style={{ flex: 1 }}>{children}</View>
      {toolbarAccessory}
      {React.cloneElement(header, {
        menuIcon: "folder-outline",
        onLeftMenuButtonPress: header.props.canGoBack
          ? header.props.onLeftMenuButtonPress
          : presentNotesNavigationSheet
      })}
    </>
  );
}
