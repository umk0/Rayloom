// SPDX-License-Identifier: GPL-2.0-or-later
// Local, user-scoped host for the Rayloom desktop. Upstream plugin ABI is unchanged.
#include "LumenHost.h"
#include "ResourceManager.h"
#include "DetectionManager.h"
#include "PluginManager.h"
#include "ProfileManager.h"
#include "LogManager.h"
#include "RGBController.h"
#include "LumenDeviceMetrics.h"
#include "LumenFrameMailbox.h"
#include <QApplication>
#include <QLocalServer>
#include <QLocalSocket>
#include <QTimer>
#include <QPointer>
#include <QAction>
#include <memory>
#include <stdexcept>
#include <set>
#ifdef _WIN32
#include <windows.h>
#endif

using json = nlohmann::json;

static json LumenHardwareStatus(ResourceManager* resources)
{
    json status = {{"elevated", nullptr}, {"smbusRequiresElevation", false},
                   {"detectionInProgress", resources->GetDetectionPercent() < 100},
                   {"i2cBuses", json::array()}};
#ifdef _WIN32
    status["smbusRequiresElevation"] = true;
    HANDLE token = nullptr;
    if(OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token))
    {
        TOKEN_ELEVATION elevation{};
        DWORD size = 0;
        if(GetTokenInformation(token, TokenElevation, &elevation, sizeof(elevation), &size))
            status["elevated"] = elevation.TokenIsElevated != 0;
        CloseHandle(token);
    }
#endif
    // Read the already discovered bus inventory. Never scan addresses here.
    // Detection owns this collection while it runs; query it after completion.
    if(!status["detectionInProgress"].get<bool>())
        for(const auto& bus : resources->GetI2CBusInfo())
            status["i2cBuses"].push_back({{"name", bus.device_name}, {"busId", bus.bus_id},
                {"portId", bus.port_id}, {"pciVendor", bus.pci_vendor}, {"pciDevice", bus.pci_device}});
    status["i2cBusCount"] = status["i2cBuses"].size();
    return status;
}

class LumenPreviewController final : public RGBController
{
public:
    LumenPreviewController()
    {
        name = "Rayloom Virtual Strip";
        vendor = "Rayloom";
        description = "Software test device; no physical LEDs";
        version = "1"; serial = "preview-001"; location = "Rayloom:virtual";
        type = DEVICE_TYPE_LEDSTRIP;
        mode direct{};
        direct.name = "Direct";
        direct.flags = MODE_FLAG_HAS_PER_LED_COLOR;
        direct.color_mode = MODE_COLORS_PER_LED;
        modes.push_back(direct);
        zone strip{};
        strip.name = "Preview"; strip.type = ZONE_TYPE_LINEAR;
        strip.leds_count = strip.leds_min = strip.leds_max = 60;
        zones.push_back(strip);
        for(unsigned int i = 0; i < 60; ++i)
        {
            led pixel{}; pixel.name = "LED " + std::to_string(i + 1);
            leds.push_back(pixel);
        }
        SetupColors();
    }
    ~LumenPreviewController() { Shutdown(); }
};

static OpenRGBPluginEntry& FindPlugin(PluginManager* manager, const json& request)
{
    const auto id = request.at("plugin").get<std::string>();
    for(auto& entry : manager->ActivePlugins)
        if(entry.id.toStdString() == id) return entry;
    throw std::runtime_error("Plugin not found: " + id);
}

static void FlushLumenFrames(ResourceManager* resources)
{
    for(auto* c:resources->GetRGBControllers())
    {
        const auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(5);
        while(lumen_frames::Busy(c))
        {
            if(std::chrono::steady_clock::now()>deadline)throw std::runtime_error("Controller frame drain timed out");
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
        c->WaitForDeviceUpdate();
    }
}

int RunLumenHost(int argc, char** argv)
{
    QApplication app(argc, argv);
    app.setApplicationName("Rayloom Core");
    app.setQuitOnLastWindowClosed(false);
    auto* resources = ResourceManager::get();
    auto* manager = new PluginManager();
    resources->SetPluginManager(manager);
    manager->RegisterAddPluginCallback([](void*,OpenRGBPluginEntry* p){if(p->plugin){auto* widget=p->plugin->GetWidget();if(widget)widget->hide();}},manager);
    if(qEnvironmentVariable("RAYLOOM_VIRTUAL_DEVICE") == "1")
    {
        DetectionManager::get()->RegisterRGBController(new LumenPreviewController());
        resources->UpdateDeviceList();
    }
    // Some upstream plugins synchronously wait for detection while other plugins
    // dispatch blocking UI callbacks. Load the set only after detection completes.
    bool plugins_ready=false;
    QTimer plugin_loader;
    auto load_plugins=[&](){plugin_loader.stop();manager->ScanAndLoadPlugins();plugins_ready=true;};
    if(qEnvironmentVariable("RAYLOOM_VIRTUAL_DEVICE")=="1")load_plugins();
    else {QObject::connect(&plugin_loader,&QTimer::timeout,&app,[&](){if(resources->GetDetectionPercent()>=100)load_plugins();});plugin_loader.start(50);}

    QLocalServer server;
    server.setSocketOptions(QLocalServer::UserAccessOption);
    if(!server.listen(qEnvironmentVariable("RAYLOOM_CORE_PIPE"))) return 3;
    const auto token = qEnvironmentVariable("RAYLOOM_CORE_TOKEN").toStdString();
    if(token.empty()) return 4;
    QObject::connect(&server, &QLocalServer::newConnection, &app, [&]() {
        while(auto* socket = server.nextPendingConnection())
        {
            auto buffer = std::make_shared<QByteArray>();
            QObject::connect(socket, &QLocalSocket::disconnected, socket, &QObject::deleteLater);
            QObject::connect(socket, &QLocalSocket::readyRead, socket, [&, socket, buffer]() {
                buffer->append(socket->readAll());
                if(buffer->size() > 1024 * 1024) { socket->disconnectFromServer(); return; }
                while(buffer->contains('\n'))
                {
                    int end = buffer->indexOf('\n');
                    auto line = buffer->left(end); buffer->remove(0, end + 1);
                    json response = {{"id", nullptr}};
                    try
                    {
                        auto request = json::parse(line.toStdString());
                        response["id"] = request.at("id");
                        if(request.value("token", std::string()) != token)
                            throw std::runtime_error("Unauthorized");
                        auto method = request.at("method").get<std::string>();
                        json result;
                        if(method=="runtime.wait")
                        {
                            const auto ms=request.value("ms",-1.0);if(!std::isfinite(ms)||ms<0||ms>100)throw std::runtime_error("Invalid pacing interval");
                            const int pending=socket->property("lumen_waits").toInt();if(pending>=4)throw std::runtime_error("Too many pending pacing requests");
                            socket->setProperty("lumen_waits",pending+1);
                            auto* timer=new QTimer(socket);timer->setSingleShot(true);timer->setTimerType(Qt::PreciseTimer);
                            auto reply=json({{"id",request.at("id")},{"result",true}}).dump()+"\n";
                            QObject::connect(timer,&QTimer::timeout,socket,[socket,timer,reply](){socket->setProperty("lumen_waits",socket->property("lumen_waits").toInt()-1);socket->write(reply.data(),static_cast<qint64>(reply.size()));timer->deleteLater();});
                            timer->start(static_cast<int>(std::ceil(ms)));continue;
                        }
                        if(method == "status")
                            result = {{"name", "Rayloom Core"}, {"upstream", "1.1"},
                                      {"pluginApi", OPENRGB_PLUGIN_API_VERSION}, {"bridgeApi", 1}, {"pluginsReady",plugins_ready},
                                      {"qt", qVersion()}, {"detectionPercent",resources->GetDetectionPercent()}, {"detectionEnabled",resources->GetDetectionEnabled()}, {"virtual", qEnvironmentVariable("RAYLOOM_VIRTUAL_DEVICE") == "1"}};
                        else if(method == "devices.rescan") {
                            if(qEnvironmentVariable("RAYLOOM_VIRTUAL_DEVICE")=="1")throw std::runtime_error("Switch to hardware mode to scan devices");
                            if(resources->GetDetectionPercent()<100)throw std::runtime_error("Detection is already running");
                            FlushLumenFrames(resources);QTimer::singleShot(0,&app,[resources](){resources->RescanDevices();});result=true;
                        }
                        else if(method == "diagnostics") {
                            result=json::array();for(auto& log:LogManager::get()->GetLogBuffer())if(log->level<=LL_WARNING||log->level==LL_DIALOG)result.push_back({{"level",log->level},{"message",log->text}});
                        }
                        else if(method == "hardware.status")
                            result = LumenHardwareStatus(resources);
                        else if(method == "plugins.list")
                        {
                            result = json::array();
                            for(auto& p : manager->ActivePlugins)
                                result.push_back({{"id", p.id.toStdString()}, {"name", p.info.Name},
                                    {"version", p.info.Version}, {"api", p.api_version},
                                    {"loaded", p.plugin != nullptr && p.enabled}, {"incompatible", p.incompatible},
                                    {"error", p.incompatible ? p.loader->errorString().toStdString() : ""}});
                        }
                        else if(method == "devices.list")
                        {
                            result = json::array();
                            unsigned int index = 0;
                            for(auto* c : resources->GetRGBControllers())
                            {
                                json colors = json::array();
                                json zones = json::array();for(unsigned int z=0;z<c->GetZoneCount();z++){
                                    auto w=c->GetZoneMatrixMapWidth(z),h=c->GetZoneMatrixMapHeight(z);auto* data=c->GetZoneMatrixMapData(z);json matrix=json::array();
                                    if(data&&w*h<=65536)for(unsigned int i=0;i<w*h;i++)matrix.push_back(data[i]==0xffffffff?-1:static_cast<int>(data[i]));
                                    zones.push_back({{"index",z},{"name",c->GetZoneDisplayName(z)},{"ledCount",c->GetZoneLEDsCount(z)},{"startIndex",c->GetZoneStartIndex(z)},{"type",c->GetZoneType(z)},{"ledsMin",c->GetZoneLEDsMin(z)},{"ledsMax",c->GetZoneLEDsMax(z)},{"activeMode",c->GetZoneActiveMode(z)},{"matrix",{{"width",w},{"height",h},{"map",matrix}}}});
                                }
                                json leds=json::array();for(unsigned int i=0;i<c->GetLEDCount();i++)leds.push_back(c->GetLEDDisplayName(i));
                                for(unsigned int i = 0; i < c->GetLEDCount(); ++i) colors.push_back(c->GetColor(i));
                                result.push_back({{"index", index++}, {"name", c->GetName()},
                                    {"vendor", c->GetVendor()}, {"type",c->GetDeviceType()}, {"ledNames",leds}, {"serial", c->GetSerial()},
                                    {"location", c->GetLocation()}, {"ledCount", c->GetLEDCount()}, {"colors", colors},
                                    {"description", c->GetDescription()}, {"version", c->GetVersion()},
                                    {"activeMode",c->GetActiveMode()},{"modeCount",c->GetModeCount()},{"zoneCount", c->GetZoneCount()},{"zones",zones}});
                                const auto metrics=lumen_metrics::Get(c);
                                result.back()["metrics"]={{"updates",metrics.updates},{"driverFps",metrics.driverFps},{"lastUpdateMs",metrics.lastUpdateMs},{"averageMs",metrics.averageMs},{"lastMs",metrics.lastMs}};
                            }
                        }
                        else if(method == "devices.sample")
                        {
                            if(resources->GetDetectionPercent()<100)throw std::runtime_error("Device detection is running");
                            const auto& id=request.at("device");RGBControllerInterface* found=nullptr;
                            for(auto* c:resources->GetRGBControllers())if(c->GetName()==id.at("name")&&c->GetSerial()==id.at("serial")&&c->GetLocation()==id.at("location")){if(found)throw std::runtime_error("Ambiguous device");found=c;}
                            if(!found)throw std::runtime_error("Device disconnected");
                            const auto& indices=request.at("indices");if(!indices.is_array()||indices.size()>16384)throw std::runtime_error("Invalid sample size");
                            for(auto& i:indices)if(!i.is_number_integer()||i.get<int64_t>()<0||i.get<int64_t>()>=found->GetLEDCount())throw std::runtime_error("Invalid sample LED");
                            result=json::array();for(auto& i:indices)result.push_back(found->GetColor(i.get<unsigned int>()));
                        }
                        else if(method == "devices.flush"){FlushLumenFrames(resources);result=true;}
                        else if(method == "devices.prepare" || method == "devices.frame" || method == "devices.restore")
                        {
                            if(resources->GetDetectionPercent()<100)throw std::runtime_error("Device detection is running");
                            auto frames=request.at("frames");if(!frames.is_array()||frames.size()>128)throw std::runtime_error("Invalid frame batch");
                            std::vector<std::pair<RGBControllerInterface*,json>> staged;std::set<RGBControllerInterface*> seen;size_t total=0;
                            for(auto& frame:frames){auto id=frame.at("device");RGBControllerInterface* found=nullptr;for(auto* c:resources->GetRGBControllers())if(c->GetName()==id.at("name")&&c->GetSerial()==id.at("serial")&&c->GetLocation()==id.at("location")){if(found)throw std::runtime_error("Ambiguous device");found=c;}
                                if(!found)throw std::runtime_error("Device disconnected");if(!seen.insert(found).second)throw std::runtime_error("Duplicate frame device");
                                auto pixels=frame.value("pixels",json::array());if(!pixels.is_array())throw std::runtime_error("Invalid pixels");total+=pixels.size();if(total>16384)throw std::runtime_error("Frame too large");
                                for(auto& p:pixels)if(!p.is_array()||p.size()!=2||!p[0].is_number_integer()||!p[1].is_number_integer()||p[0].get<int64_t>()<0||p[0].get<int64_t>()>=found->GetLEDCount()||p[1].get<int64_t>()<0||p[1].get<int64_t>()>0xffffff)throw std::runtime_error("Invalid LED address or color");
                                if(method=="devices.restore"){if(!frame.at("activeMode").is_number_integer()||frame.at("activeMode").get<int>()<0||frame.at("activeMode").get<int>()>=static_cast<int>(found->GetModeCount()))throw std::runtime_error("Invalid restore mode");if(frame.contains("zoneModes")){auto z=frame.at("zoneModes");if(!z.is_array()||z.size()!=found->GetZoneCount())throw std::runtime_error("Invalid zone modes");for(size_t i=0;i<z.size();i++)if(!z[i].is_number_integer()||z[i].get<int>()<-1||z[i].get<int>()>=static_cast<int>(found->GetZoneModeCount(i)))throw std::runtime_error("Invalid zone restore mode");}}
                                staged.push_back({found,pixels});
                            }
                            if(method!="devices.frame")FlushLumenFrames(resources);
                            for(size_t index=0;index<staged.size();index++)
                            {
                                auto& entry=staged[index];
                                if(method=="devices.prepare")entry.first->SetCustomMode();
                                else
                                {
                                    lumen_frames::Pixels pixels;for(const auto& p:entry.second)pixels[p[0].get<unsigned int>()]=p[1].get<uint32_t>();
                                    if(method=="devices.frame"&&lumen_frames::Queue(entry.first,pixels))continue;
                                    // Third-party virtual controllers keep their original API path.
                                    for(auto& p:entry.second)entry.first->SetColor(p[0],p[1]);
                                    if(method=="devices.restore"){entry.first->SetActiveMode(frames[index].at("activeMode"));if(frames[index].contains("zoneModes"))for(unsigned int z=0;z<entry.first->GetZoneCount();z++)entry.first->SetZoneActiveMode(z,frames[index]["zoneModes"][z]);entry.first->UpdateMode();}
                                    entry.first->UpdateLEDs();
                                }
                            }
                            result=true;
                        }
                        else if(method == "shutdown")
                        {
                            FlushLumenFrames(resources);
                            result = true;
                            QTimer::singleShot(50, &app, &QApplication::quit);
                        }
                        else if(method == "profiles.list")result=resources->GetProfileManager()->GetProfileList();
                        else if(method == "profiles.save-effects")
                        {
                            auto name=request.at("name").get<std::string>();
                            if(name.empty()||name.size()>100||name.find_first_of("/\\:*?\"<>|")!=std::string::npos||name.back()=='.'||name.back()==' ')throw std::runtime_error("Invalid profile name");
                            result=resources->GetProfileManager()->SaveProfileFromPlugin(name,"OpenRGB Effects Plugin",request.at("profile"));
                        }
                        else if(method.rfind("plugin.", 0) == 0)
                        {
                            auto& p = FindPlugin(manager, request);
                            if(method == "plugin.enable")
                            {
                                if(p.incompatible) throw std::runtime_error("Incompatible native plugin API");
                                manager->EnablePlugin(p.path);
                                if(!p.plugin || !p.enabled) throw std::runtime_error(p.loader->errorString().toStdString());
                                result = true;
                            }
                            else
                            {
                                if(!p.plugin || !p.enabled) throw std::runtime_error("Plugin is not enabled");
                                if(method == "plugin.rpc")
                                {
                                    auto payload=request.at("request").dump();
                                    unsigned int size=static_cast<unsigned int>(payload.size());
                                    std::unique_ptr<unsigned char[]> output(p.plugin->OnSDKCommand(0x4C554D31,reinterpret_cast<unsigned char*>(payload.data()),&size));
                                    if(!output||size>8*1024*1024)throw std::runtime_error("Plugin does not support Lumen API v1");
                                    auto reply=json::parse(output.get(),output.get()+size);
                                    if(reply.contains("error"))throw std::runtime_error(reply["error"].get<std::string>());
                                    result=reply.at("result");
                                }
                                else if(method == "plugin.profile.get") result = p.plugin->OnProfileSave();
                                else if(method == "plugin.profile.set")
                                {
                                    p.plugin->OnProfileAboutToLoad();
                                    p.plugin->OnProfileLoad(request.at("profile"));
                                    result = p.plugin->OnProfileSave();
                                }
                                else if(method == "plugin.window")
                                {
                                    auto* widget = p.plugin->GetWidget();
                                    if(!widget) throw std::runtime_error("Plugin has no native panel");
                                    widget->setWindowTitle(QString::fromStdString("Rayloom / " + p.info.Name));
                                    widget->resize(1000, 720); widget->show(); widget->raise(); widget->activateWindow();
#ifdef _WIN32
                                    // The core starts with a hidden console. Explicitly show the
                                    // requested plugin panel after Windows consumes SW_HIDE.
                                    ShowWindow(reinterpret_cast<HWND>(widget->winId()), SW_SHOWNORMAL);
                                    SetForegroundWindow(reinterpret_cast<HWND>(widget->winId()));
#endif
                                    result = {{"visible", widget->isVisible()}, {"title", widget->windowTitle().toStdString()}};
                                }
                                else if(method == "plugin.actions")
                                {
                                    result = json::array();
                                    if(!p.traymenu) p.traymenu = p.plugin->GetTrayMenu();
                                    if(p.traymenu) for(auto* action : p.traymenu->actions())
                                        if(!action->isSeparator()) result.push_back({{"id", action->objectName().toStdString()}, {"title", action->text().toStdString()}});
                                }
                                else if(method == "plugin.action")
                                {
                                    if(!p.traymenu) p.traymenu = p.plugin->GetTrayMenu();
                                    bool found = false;
                                    if(p.traymenu) for(auto* action : p.traymenu->actions())
                                        if(action->objectName().toStdString() == request.at("action").get<std::string>())
                                        { action->trigger(); found = true; break; }
                                    if(!found) throw std::runtime_error("Unknown action");
                                    result = true;
                                }
                                else throw std::runtime_error("Unknown plugin method");
                            }
                        }
                        else throw std::runtime_error("Unknown method");
                        response["result"] = result;
                    }
                    catch(const std::exception& e) { response["error"] = e.what(); }
                    auto bytes = response.dump() + "\n";
                    socket->write(bytes.data(), static_cast<qint64>(bytes.size()));
                }
            });
        }
    });
    int exit_code = app.exec();
    manager->UnloadPlugins();
    return exit_code;
}
