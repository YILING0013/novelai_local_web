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
[assembly: AssemblyVersion("1.0.0.0")]

internal sealed class LocalDesktop : Form
{
    private const string Title = "NovelAI Local";
    private const string Origin = "http://127.0.0.1:47861";
    private const string Instance = @"Local\NovelAI.Local.Desktop.1";
    private readonly WebView2 view = new WebView2 { Dock = DockStyle.Fill };
    private readonly Label loading = new Label {
        Text = "正在启动本地工作台…", Dock = DockStyle.Fill,
        TextAlign = ContentAlignment.MiddleCenter, Font = SystemFonts.MessageBoxFont
    };
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
        Text = Title;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        StartPosition = FormStartPosition.CenterScreen;
        var area = Screen.FromPoint(Cursor.Position).WorkingArea;
        MinimumSize = new Size(640, 480);
        Size = new Size(Math.Min(area.Width, 1440), Math.Min(area.Height, 940));
        Controls.Add(view);
        Controls.Add(loading);
        Shown += async delegate {
            try { await StartWorkspace(); }
            catch (Exception ex)
            {
                if (!closing) { MessageBox.Show(this, ex.Message, Title, MessageBoxButtons.OK, MessageBoxIcon.Error); Close(); }
            }
        };
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
            if (IsHandleCreated && !closing) BeginInvoke((Action)delegate {
                if (!closing) { view.Visible = false; MessageBox.Show(this, "本地服务已退出，请重新启动程序。", Title); Close(); }
            });
        };
        backend.EnableRaisingEvents = true;
        var profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Title, "WebView2");
        var environment = await CoreWebView2Environment.CreateAsync(null, profile);
        if (closing) return;
        await view.EnsureCoreWebView2Async(environment);
        if (closing) return;
        ConfigureView(view.CoreWebView2);
        await view.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
            "if(location.origin==='" + Origin + "')Object.defineProperty(window,'novelaiLocalDesktop',{value:true});");
        view.CoreWebView2.NavigationCompleted += delegate { loading.Visible = false; };
        view.CoreWebView2.Navigate(Origin + "/login");
    }

    private static bool WorkspaceUrl(string value)
    {
        Uri uri;
        return Uri.TryCreate(value, UriKind.Absolute, out uri)
            && uri.GetLeftPart(UriPartial.Authority) == Origin;
    }

    private void ConfigureView(CoreWebView2 core)
    {
        core.Settings.IsWebMessageEnabled = false;
        core.Settings.AreHostObjectsAllowed = false;
        core.AddWebResourceRequestedFilter(Origin + "/*", CoreWebView2WebResourceContext.All,
                                           CoreWebView2WebResourceRequestSourceKinds.All);
        core.WebResourceRequested += (sender, args) => {
            if (!closing && !backend.HasExited && WorkspaceUrl(args.Request.Uri))
                args.Request.Headers.SetHeader("X-NAI-Desktop", key);
        };
        core.NavigationStarting += (sender, args) => {
            if (!WorkspaceUrl(args.Uri)) args.Cancel = true;
        };
        core.NewWindowRequested += async (sender, args) => {
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
                var preview = new Form { Text = "NovelAI Local · Preview", Width = 940, Height = 720, Icon = Icon };
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
                    preview.Show(this);
                }
                catch { preview.Dispose(); }
            }
        };
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        closing = true;
        if (backend != null)
        {
            backend.StandardInput.Close();
            if (!backend.WaitForExit(3500)) backend.Kill();
        }
        base.OnFormClosing(e);
    }
}
