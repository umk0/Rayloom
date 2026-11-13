import {createRoot} from 'react-dom/client';
import {MantineProvider} from '@mantine/core';
import '@mantine/core/styles.css';
import '@fontsource-variable/inter';
import {RayloomApp} from './mantine/RayloomApp';
import {rayloomTheme} from './mantine/theme';
import './mantine/rayloom.css';
createRoot(document.getElementById('root')!).render(<MantineProvider theme={rayloomTheme} forceColorScheme="dark"><RayloomApp/></MantineProvider>);
