using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows.Forms;

// Portable entry point. Electron and the application live beside this small
// launcher; the lighting agent continues independently after this process exits.
class RayloomLauncher {
 [STAThread] static int Main(string[] args) {
  bool checkOnly=args.Length==1&&args[0]=="--check-only";
  try {
   if(args.Length!=0&&!checkOnly)throw new ArgumentException("Unknown launcher argument");
   string root=AppDomain.CurrentDomain.BaseDirectory;
   string electron=Path.Combine(root,"electron","electron.exe");
   string application=Path.Combine(root,"app");
   foreach(string file in new [] {electron,Path.Combine(application,"package.json"),Path.Combine(application,"dist","index.html"),Path.Combine(application,"core","release","Rayloom-Core.exe"),Path.Combine(application,"runtime","Rayloom-Agent.exe")})
    if(!File.Exists(file))throw new FileNotFoundException("Rayloom installation is incomplete: "+file);
   string profileFile=Path.Combine(Path.GetFullPath(Path.Combine(root,"..")),"profile-path.txt");
   string profile=File.Exists(profileFile)?File.ReadAllText(profileFile,Encoding.UTF8).Trim():null;
   if(profile!=null&&(profile.Length<4||!Path.IsPathRooted(profile)||profile.StartsWith(@"\\",StringComparison.Ordinal)))
    throw new InvalidDataException("Invalid Rayloom profile path");
   if(checkOnly)return 0;
   var start=new ProcessStartInfo(electron);
   start.Arguments=Quote(application);
   start.WorkingDirectory=application;
   start.UseShellExecute=false;
   start.CreateNoWindow=true;
   start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
   if(profile!=null)start.EnvironmentVariables["RAYLOOM_USER_DATA"]=profile;
   using(var child=Process.Start(start))if(child==null)throw new InvalidOperationException("Could not start Rayloom");
   return 0;
  } catch(Exception error) {
   if(!checkOnly)MessageBox.Show(error.Message,"Rayloom",MessageBoxButtons.OK,MessageBoxIcon.Error);
   return 1;
  }
 }
 static string Quote(string value) {
  var result=new StringBuilder("\"");int slashes=0;
  foreach(char c in value){if(c=='\\'){slashes++;continue;}if(c=='"'){result.Append('\\',slashes*2+1);result.Append(c);}else{result.Append('\\',slashes);result.Append(c);}slashes=0;}
  result.Append('\\',slashes*2);result.Append('"');return result.ToString();
 }
}
