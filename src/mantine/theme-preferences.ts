export const defaultTheme={name:'Quiet',accent:'#b7cd83',background:'#17191b',panel:'#202325',text:'#edeee8',load_at_startup:true};

/** Apply saved palette preferences without importing the plugin settings screen. */
export function applyTheme(theme:any){
  for(const key of ['accent','background','panel','text']) {
    if(/^#[0-9a-f]{6}$/i.test(theme?.[key]))document.documentElement.style.setProperty('--rayloom-'+key,theme[key]);
  }
  if(/^#[0-9a-f]{6}$/i.test(theme?.accent)) {
    document.documentElement.style.setProperty('--mantine-primary-color-filled',theme.accent);
    document.documentElement.style.setProperty('--mantine-primary-color-4',theme.accent);
  }
}
