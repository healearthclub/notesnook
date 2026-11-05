import { NativePortals } from "./heal-native-portals";
/* Heal Earth native React workspace. GPL-3.0-or-later. */
import React from "react";
import "./app.css";
import { CacheProvider } from "@emotion/react";
import createCache from "@emotion/cache";
import { BaseThemeProvider } from "./components/theme-provider";
import { ErrorBoundary } from "./components/error-boundary";
import AppLock from "./views/app-lock";
import { RouteWrapper } from "./root";
export function createNativeWorkspace(data: any, shadow: ShadowRoot) {
  const cache = createCache({ key: "healnotes", container: shadow as any });
  return function NativeNotesWorkspace() {
    return (
      <CacheProvider value={cache}>
        <ErrorBoundary>
          <BaseThemeProvider
            sx={{
              bg: "background",
              flex: 1,
              height: "100%",
              overflow: "hidden"
            }}
          >
            <AppLock>
              <RouteWrapper
                Component={data.Component}
                path={data.path}
                routeProps={data.props}
                persistence={data.persistence}
              />
              <NativePortals />
            </AppLock>
          </BaseThemeProvider>
        </ErrorBoundary>
      </CacheProvider>
    );
  };
}
