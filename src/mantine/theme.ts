import {createTheme,Button,TextInput,NumberInput,Select,Modal,Drawer,Popover,Tooltip} from '@mantine/core';
export const rayloomTheme=createTheme({
 primaryColor:'ray',primaryShade:4,fontFamily:'Inter Variable, Inter, system-ui, sans-serif',fontFamilyMonospace:'Consolas, monospace',defaultRadius:'md',
 colors:{ray:['#f6fbe8','#eaf5cc','#ddf0ac','#d0eb8e','#c5e879','#b6dc64','#a3cb50','#86ad38','#66862a','#4b6320'],dark:['#e9ecee','#c2ccd2','#98a5ad','#6a7881','#3a454e','#2b353c','#222b31','#191f24','#141a1e','#101518']},
 headings:{fontFamily:'Inter Variable, Inter, system-ui, sans-serif',fontWeight:'600',sizes:{h1:{fontSize:'30px',lineHeight:'1.25'},h2:{fontSize:'23px',lineHeight:'1.3'},h3:{fontSize:'17px',lineHeight:'1.4'}}},
 fontSizes:{xs:'12px',sm:'14px',md:'15px',lg:'17px',xl:'20px'},radius:{xs:'4px',sm:'6px',md:'9px',lg:'12px',xl:'16px'},
 components:{Button:Button.extend({defaultProps:{size:'sm',fw:550,variant:'filled'}}),TextInput:TextInput.extend({defaultProps:{size:'sm'}}),NumberInput:NumberInput.extend({defaultProps:{size:'sm'}}),Select:Select.extend({defaultProps:{size:'sm',comboboxProps:{zIndex:1200}}}),Modal:Modal.extend({defaultProps:{zIndex:1100,centered:true,overlayProps:{backgroundOpacity:.55,blur:3}}}),Drawer:Drawer.extend({defaultProps:{zIndex:1100,overlayProps:{backgroundOpacity:.55}}}),Popover:Popover.extend({defaultProps:{zIndex:1200,shadow:'md',withinPortal:true}}),Tooltip:Tooltip.extend({defaultProps:{zIndex:1300,openDelay:400}})}
});
