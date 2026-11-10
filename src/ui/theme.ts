import { useColorScheme } from 'react-native';
import { aspect, colours, motion, radius, space, touchTarget, type, type ColourTokens } from './tokens';

export type Theme = {
  scheme: 'light' | 'dark';
  colours: ColourTokens;
  space: typeof space;
  radius: typeof radius;
  type: typeof type;
  touchTarget: number;
  motion: typeof motion;
  aspect: typeof aspect;
};

export function makeTheme(scheme: 'light' | 'dark'): Theme {
  return { scheme, colours: colours[scheme], space, radius, type, touchTarget, motion, aspect };
}

const themes = { light: makeTheme('light'), dark: makeTheme('dark') };

/** Current theme, following the system light/dark setting. */
export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? themes.dark : themes.light;
}
