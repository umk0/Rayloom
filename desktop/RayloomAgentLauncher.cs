using System;
using System.Diagnostics;
using System.IO;
using System.Security.Principal;
using System.Text;
using System.Windows.Forms;

// A short-lived WinExe bootstrap: no console, no resident CLR, no Chromium.
// The standalone Node process owns lighting after this launcher has exited.
class RayloomAgentLauncher {
 [STAThread] static int Main(string[] args) {
  string data=Environment.GetEnvironmentVariable("RAYLOOM_USER_DATA")??Environment.GetEnvironmentVariable("LUMEN_USER_DATA");
  if(string.IsNullOrEmpty(data))data=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"user-data");
  bool silent=Array.IndexOf(args,"--silent")>=0, checkOnly=Array.IndexOf(args,"--check-only")>=0;
  try {
   string root=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,".."));
   data=Path.GetFullPath(data);
   string mode=null;bool requireElevated=false;
   for(int i=0;i<args.Length;i++) {
    if(args[i]=="--data"||args[i]=="--mode") {
     string key=args[i];if(++i>=args.Length)throw new ArgumentException("Missing value for "+key);
     if(key=="--data") {if(args[i].Length<3||!char.IsLetter(args[i][0])||args[i][1]!=':'||(args[i][2]!='\\'&&args[i][2]!='/'))throw new ArgumentException("Data directory must be an absolute local Windows path");data=Path.GetFullPath(args[i]);}
     else {mode=args[i];if(mode!="hardware"&&mode!="virtual")throw new ArgumentException("Invalid lighting mode");}
    } else if(args[i]=="--require-elevated")requireElevated=true;
    else if(args[i]!="--silent"&&args[i]!="--check-only")throw new ArgumentException("Unknown launcher argument: "+args[i]);
   }
   if(data.StartsWith(@"\\",StringComparison.Ordinal))throw new ArgumentException("Data directory must be local");
   if(requireElevated&&!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator))
    throw new InvalidOperationException("Для доступа к RGB памяти подтвердите стандартный запрос Windows UAC.");
   string node=Path.Combine(root,"runtime","node","node.exe"),agent=Path.Combine(root,"desktop","runtime-agent.mjs");
   if(!File.Exists(node)||!File.Exists(agent))throw new FileNotFoundException("Не найден фоновый движок Rayloom. Восстановите установку приложения.");
   if(checkOnly)return 0;
   var start=new ProcessStartInfo(node);
   start.Arguments=Quote(agent)+" --data "+Quote(data)+(mode==null?"":" --mode "+Quote(mode));
   start.WorkingDirectory=root;start.UseShellExecute=false;start.CreateNoWindow=true;
   start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
   // runtime-agent binds its deterministic per-data-directory pipe before it
   // starts a core. That bind, not a stale PID file, enforces single ownership.
   using(var child=Process.Start(start)) {if(child==null)throw new InvalidOperationException("Не удалось запустить агент");}
   return 0;
  } catch(Exception error){
   if(!checkOnly)try{Directory.CreateDirectory(data);File.AppendAllText(Path.Combine(data,"launcher.log"),DateTime.UtcNow.ToString("o")+" "+error.Message+Environment.NewLine,Encoding.UTF8);}catch{}
   if(!silent)MessageBox.Show(error.Message,"Rayloom — фоновый запуск",MessageBoxButtons.OK,MessageBoxIcon.Error);
   return 1;
  }
 }
 // Windows argv quoting, including paths ending in a backslash and quotes.
 static string Quote(string value){
  var result=new StringBuilder("\"");int slashes=0;
  foreach(char c in value){if(c=='\\'){slashes++;continue;}if(c=='"'){result.Append('\\',slashes*2+1);result.Append(c);}else{result.Append('\\',slashes);result.Append(c);}slashes=0;}
  result.Append('\\',slashes*2);result.Append('"');return result.ToString();
 }
}
