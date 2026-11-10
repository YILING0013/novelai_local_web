using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("NovelAI Local")]
[assembly: AssemblyProduct("NovelAI Local")]
[assembly: AssemblyVersion("1.1.0.0")]

internal sealed class LocalDesktop : ApplicationContext
{
    private const string Title = "NovelAI Local";
    internal const string Origin = "http://127.0.0.1:47861";
    private const string Instance = @"Local\NovelAI.Local.Desktop.1";
    private DesktopWindow current;
    private DesktopWindow switching;
    private CoreWebView2Environment environment;
    private Rectangle? workspaceBounds;
    private Process backend;
    private bool closing;
    private string key;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindow(string className, string title);
    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr window, int command);

    [STAThread]
    private static void Main()
    {
        bool first;
        using (var mutex = new Mutex(true, Instance, out first))
        {
            if (!first)
            {
                var previous = FindWindow(null, Title);
                if (IsIconic(previous)) ShowWindow(previous, 9);
                SetForegroundWindow(previous);
                return;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new LocalDesktop());
        }
    }

    private LocalDesktop()
    {
        current = new DesktopWindow(this, "auth");
        current.FormClosed += WindowClosed;
        current.Shown += async delegate {
            try { await StartWorkspace(); }
            catch (Exception ex) { if (!closing) { MessageBox.Show(current, ex.Message, Title, MessageBoxButtons.OK, MessageBoxIcon.Error); current.Retire(); } }
        };
        current.Show();
    }

    private void WindowClosed(object sender, FormClosedEventArgs args)
    {
        if (sender != current || closing) return;
        closing = true;
        if (switching != null && !switching.IsDisposed) switching.Retire();
        if (backend != null)
        {
            backend.StandardInput.Close();
            if (!backend.WaitForExit(3500)) backend.Kill();
            backend.Dispose();
        }
        ExitThread();
    }

    internal async void Switch(DesktopWindow source, string role, bool leaveApproved = false)
    {
        if (source != current || closing || switching != null || source.Role == role) return;
        var target = new DesktopWindow(this, role);
        switching = target;
        try
        {
            if ((!leaveApproved && !await source.CanLeave()) || closing) return;
            if (source.Role != "auth")
                workspaceBounds = source.WindowState == FormWindowState.Normal ? source.Bounds : source.RestoreBounds;
            if (role != "auth" && workspaceBounds.HasValue && Screen.FromRectangle(workspaceBounds.Value).WorkingArea.Contains(workspaceBounds.Value))
                target.Bounds = workspaceBounds.Value;
            target.Opacity = 0;
            target.ShowInTaskbar = false;
            target.Show();
            await target.LoadStudio(environment);
            if (closing) return;
            current = target;
            target.FormClosed += WindowClosed;
            target.ShowInTaskbar = true;
            target.Opacity = 1;
            target.Activate();
            source.Retire();
        }
        catch (Exception ex) { if (!closing) MessageBox.Show(source, ex.Message, Title, MessageBoxButtons.OK, MessageBoxIcon.Error); }
        finally
        {
            switching = null;
            if (current != target && !target.IsDisposed) target.Retire();
        }
    }

    private async Task StartWorkspace()
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
#if SOURCE_WORKSPACE
        root = Path.GetFullPath(Path.Combine(root, @"..\..\.."));
        string python = Path.Combine(root, @"nai_flask\.venv\Scripts\python.exe");
#else
        string python = Path.Combine(root, @"runtime\python.exe");
#endif
        var info = new ProcessStartInfo(python, "-I -B -u -c \"import sys;sys.path.insert(0,'.');from desktop_service import main;main()\"") {
            WorkingDirectory = Path.Combine(root, "nai_flask"), UseShellExecute = false,
            CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        backend = Process.Start(info);
        // The backend logs structured request diagnostics to stderr. Drain without persisting them.
        backend.BeginErrorReadLine();
        var handshake = backend.StandardOutput.ReadLineAsync();
        if (await Task.WhenAny(handshake, Task.Delay(60000)) != handshake)
            throw new InvalidOperationException("本地服务启动超时，请关闭后重试。");
        key = await handshake;
        if (closing) return;
        if (key == null || key.Length != 43)
            throw new InvalidOperationException("本地服务启动失败。请检查端口 47861 是否空闲，以及用户数据目录是否可写。");
        backend.Exited += delegate {
            var window = current;
            if (!closing && window.IsHandleCreated) window.BeginInvoke((Action)delegate {
                if (!closing) { MessageBox.Show(current, "本地服务已退出，请重新启动程序。", Title); current.Retire(); }
            });
        };
        backend.EnableRaisingEvents = true;
        var profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Title, "WebView2");
        environment = await CoreWebView2Environment.CreateAsync(null, profile);
        if (!closing) await current.LoadStudio(environment);
    }

    private static bool WorkspaceUrl(string value)
    {
        Uri uri;
        return Uri.TryCreate(value, UriKind.Absolute, out uri) && uri.GetLeftPart(UriPartial.Authority) == Origin;
    }

    internal static bool StudioUrl(string value)
    {
        return WorkspaceUrl(value) && new Uri(value).AbsolutePath == "/studio/index.html";
    }

    internal void ConfigureRequests(CoreWebView2 core)
    {
        core.AddWebResourceRequestedFilter(Origin + "/*", CoreWebView2WebResourceContext.All,
                                           CoreWebView2WebResourceRequestSourceKinds.All);
        core.WebResourceRequested += (sender, args) => {
            if (!closing && !backend.HasExited && WorkspaceUrl(args.Request.Uri))
                args.Request.Headers.SetHeader("X-NAI-Desktop", key);
        };
    }

    internal async void OpenPreview(Form owner, CoreWebView2 core, CoreWebView2NewWindowRequestedEventArgs args)
    {
        args.Handled = true;
        if (!args.IsUserInitiated) return;
        Uri uri;
        if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out uri)) return;
        if (uri.Scheme == "https")
        {
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
            return;
        }
        if (!WorkspaceUrl(args.Uri) && !args.Uri.StartsWith("blob:" + Origin + "/")
            && !args.Uri.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase)) return;
        // Keep image previews in the same WebView environment so blob URLs remain usable.
        using (var deferral = args.GetDeferral())
        {
            var preview = new Form { Text = "NovelAI Local · Preview", Width = 940, Height = 720, Icon = owner.Icon };
            var image = new WebView2 { Dock = DockStyle.Fill };
            preview.Controls.Add(image);
            try
            {
                await image.EnsureCoreWebView2Async(core.Environment);
                image.CoreWebView2.Settings.IsScriptEnabled = false;
                image.CoreWebView2.Settings.IsWebMessageEnabled = false;
                image.CoreWebView2.Settings.AreHostObjectsAllowed = false;
                image.CoreWebView2.AddWebResourceRequestedFilter(Origin + "/*", CoreWebView2WebResourceContext.All);
                image.CoreWebView2.WebResourceRequested += (s, e) => {
                    if (!closing && !backend.HasExited && WorkspaceUrl(e.Request.Uri)) e.Request.Headers.SetHeader("X-NAI-Desktop", key);
                };
                args.NewWindow = image.CoreWebView2;
                preview.Show(owner);
            }
            catch { preview.Dispose(); }
        }
    }
}
