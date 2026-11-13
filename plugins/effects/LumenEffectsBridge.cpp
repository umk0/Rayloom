// SPDX-License-Identifier: GPL-2.0-or-later
#include "LumenEffectsBridge.h"
#include "LumenBindings.h"
#include "EffectListManager.h"
#include "OpenRGBEffectSettings.h"
#include "AudioManager.h"
#include "AudioSettings.h"
#include "ColorUtils.h"
#include "Effects/Shaders/Shaders.h"
#include "OpenRGBEffectsPlugin.h"
#include <QComboBox>
#include <QSpinBox>
#include <QDoubleSpinBox>
#include <QAbstractSlider>
#include <QCheckBox>
#include <QLabel>
#include <QDirIterator>
#include <QScreen>
#include <QApplication>
#include <QFile>
#include <QBuffer>
#include <QPixmap>
#include <QTimer>
#include <QElapsedTimer>
#include <memory>

static json bindings=json::parse(LumenBindingsJSON);
static json catalog;
static std::map<std::string,json> descriptions;

static std::string Label(std::string s)
{
    for(char& c:s) if(c=='_') c=' ';
    return s;
}

static json Field(const std::string& key,const json& value,QWidget* owner,const json& map)
{
    json f={{"key",key},{"label",Label(key)},{"type",value.type_name()}};
    QString name=QString::fromStdString(map.value(key,key));
    QWidget* w=owner?owner->findChild<QWidget*>(name):nullptr;
    if(key=="clock_mode"&&owner)w=owner->findChild<QWidget*>("clock_mode_combo_box");
    if(w && !w->toolTip().isEmpty()) f["help"]=w->toolTip().toStdString();
    if(auto* box=qobject_cast<QComboBox*>(w))
    {
        f["type"]="enum"; f["options"]=json::array();
        for(int i=0;i<box->count();i++)f["options"].push_back({{"label",box->itemText(i).toStdString()}, {"value",value.is_string()?json(box->itemText(i).toStdString()):json(i)}});
    }
    else if(auto* spin=qobject_cast<QSpinBox*>(w)){f["min"]=spin->minimum();f["max"]=spin->maximum();f["step"]=spin->singleStep();}
    else if(auto* spin=qobject_cast<QDoubleSpinBox*>(w)){f["min"]=spin->minimum();f["max"]=spin->maximum();f["step"]=spin->singleStep();}
    else if(auto* slider=qobject_cast<QAbstractSlider*>(w))
    {
        double scale=1.;
        if(value.is_number()&&value.get<double>()!=0&&slider->value()!=0)scale=slider->value()/value.get<double>();
        f["min"]=slider->minimum()/scale;f["max"]=slider->maximum()/scale;f["step"]=slider->singleStep()/scale;
    }
    else if(auto* check=qobject_cast<QCheckBox*>(w)){if(!check->text().isEmpty())f["label"]=check->text().toStdString();}
    if(w && std::string(w->metaObject()->className())=="ColorPicker") f["type"]="color";
    if(w && std::string(w->metaObject()->className())=="ColorsPicker") f["type"]="colors";
    if(key=="audio_device")
    {
        f["type"]="enum";f["options"]=json::array({{{"label","Disabled"},{"value",-1}}});
        auto devices=AudioManager::get()->GetAudioDevices();
        for(size_t i=0;i<devices.size();i++)f["options"].push_back({{"label",devices[i]},{"value",i}});
    }
    if(key=="avg_mode"){f["type"]="enum";f["options"]={{{"label","Binning"},{"value",0}},{{"label","Low pass"},{"value",1}}};}
    if(key=="window_mode"){f["type"]="enum";f["options"]={{{"label","None"},{"value",0}},{{"label","Hanning"},{"value",1}},{{"label","Hamming"},{"value",2}},{{"label","Blackman"},{"value",3}}};}
    if(key=="fragment_shader")f["type"]="code";
    if(key=="fileName"||key=="texture_path")f["type"]="file";
    if(key=="groups")f["type"]="layers";
    if(key=="prefered_colors")f["type"]="colors";
    if(key=="bypass_min"||key=="bypass_max"||key=="color_zone_stop"||key=="motion_zone_stop"){f["min"]=0;f["max"]=256;f["step"]=1;}
    if(key=="fps"||key=="fpscapture"){f["min"]=1;f["max"]=240;f["step"]=1;}
    if(key=="brightness"){f["min"]=0;f["max"]=100;f["step"]=1;}
    if(key=="temperature"||key=="tint"){f["min"]=-100;f["max"]=100;f["step"]=1;}
    if(key=="startup_timeout"){f["min"]=0;f["max"]=60000;f["step"]=100;}
    if(value.is_object())
    {
        std::unique_ptr<AudioSettings> audio;
        Audio::AudioSettingsStruct audioValues;
        if(key=="audio_settings"){audioValues=value;audio.reset(new AudioSettings());audio->SetSettings(&audioValues);owner=audio.get();}
        f["fields"]=json::array();
        for(auto it=value.begin();it!=value.end();++it)f["fields"].push_back(Field(it.key(),it.value(),owner,json::object()));
    }
    if(value.is_array()&&!value.empty()) f["item"]=Field("item",value[0],nullptr,json::object());
    if(key=="equalizer")f["item"]={{"key","item"},{"label","Band"},{"type","number"},{"min",0},{"max",2},{"step",.01}};
    if(key=="pattern_list"&&owner)
    {
        f["item"]={{"key","item"},{"label","Pattern"},{"type","enum"},{"options",json::array()}};
        if(auto* box=owner->findChild<QComboBox*>("patterns"))for(int i=0;i<box->count();i++)f["item"]["options"].push_back({{"label",box->itemText(i).toStdString()},{"value",box->itemText(i).toStdString()}});
    }
    return f;
}

static json Describe(const std::string& id,const std::string& category)
{
    auto factory=EffectListManager::get()->GetEffectConstructor(id);
    if(!factory)throw std::runtime_error("Unknown effect: "+id);
    std::unique_ptr<RGBEffect> effect(factory());
    auto& d=effect->EffectDetails;
    effect->SetUserColors(std::vector<RGBColor>(d.UserColors,0xFFFFFF));
    auto defaults=effect->ToJson();
    // The upstream tab clamps constructor defaults with its sliders.
    if(d.MaxSpeed>d.MinSpeed)defaults["Speed"]=(std::max)(d.MinSpeed,(std::min)(d.MaxSpeed,defaults["Speed"].get<int>()));
    if(d.MaxSlider2Val>d.MinSlider2Val)defaults["Slider2Val"]=(std::max)(d.MinSlider2Val,(std::min)(d.MaxSlider2Val,defaults["Slider2Val"].get<int>()));
    if(!defaults.contains("UserColors"))defaults["UserColors"]=json::array();
    if(!defaults.contains("CustomSettings")||defaults["CustomSettings"].is_null())defaults["CustomSettings"]=json::object();
    defaults["AutoStart"]=true;defaults["SelectAll"]=false;defaults["ControllerZones"]=json::array();
    json fields=json::array();
    for(auto it=defaults["CustomSettings"].begin();it!=defaults["CustomSettings"].end();++it)
        fields.push_back(Field(it.key(),it.value(),effect.get(),bindings.value(id,json::object())));
    return {{"id",id},{"name",d.EffectName},{"description",d.EffectDescription},{"category",category},
        {"speedMin",d.MinSpeed},{"speedMax",d.MaxSpeed},{"secondaryMin",d.MinSlider2Val},{"secondaryMax",d.MaxSlider2Val},
        {"secondaryName",d.Slider2Name},{"colorCount",d.UserColors},{"random",d.SupportsRandom},
        {"onlyFirst",d.AllowOnlyFirst},{"reversible",d.IsReversable},{"defaults",defaults},{"fields",fields}};
}

static void ValidateField(const json& value,const json& f)
{
    const auto type=f.at("type").get<std::string>();
    auto fail=[&](){throw std::runtime_error("Invalid setting: "+f.at("key").get<std::string>());};
    if(type=="number"||type=="color")
    {
        if(!value.is_number())fail();
        const double n=value.get<double>();
        if(!std::isfinite(n)||(f.contains("min")&&n<f["min"].get<double>()-1e-5)||(f.contains("max")&&n>f["max"].get<double>()+1e-5))fail();
        if(type=="color"&&(!value.is_number_integer()||n<0||n>0xffffff))fail();
    }
    else if(type=="boolean"){if(!value.is_boolean())fail();}
    else if(type=="enum") {bool found=false;for(auto& o:f.at("options"))if(o.at("value")==value)found=true;if(!found)fail();}
    else if(type=="string"||type=="file"||type=="code"){if(!value.is_string()||value.get<std::string>().size()>200000)fail();}
    else if(type=="object") {if(!value.is_object())fail();for(auto& child:f.at("fields")){if(!value.contains(child.at("key")))fail();ValidateField(value.at(child.at("key").get<std::string>()),child);}}
    else if(type=="array"||type=="colors")
    {
        if(!value.is_array()||value.size()>256)fail();
        if(type=="colors"){if(value.empty()&&f.at("key")!="prefered_colors")fail();for(auto& c:value)ValidateField(c,{{"type","color"},{"key","color"}});}
        else if(f.contains("item"))for(auto& item:value)ValidateField(item,f["item"]);
        if(f.at("key")=="equalizer"&&value.size()!=16)fail();
    }
}

static void ValidateEffect(const json& e,int depth=0)
{
    if(depth>5)throw std::runtime_error("Layer nesting exceeds 5 levels");
    std::string id=e.at("EffectClassName");
    if(!descriptions.count(id))throw std::runtime_error("Unknown effect: "+id);
    const auto& d=descriptions.at(id);
    auto integer=[&](const char* key,int min,int max){if(!e.contains(key)||!e[key].is_number_integer()||e[key].get<int>()<min||e[key].get<int>()>max)throw std::runtime_error(std::string("Invalid ")+key);};
    integer("FPS",1,240);integer("Brightness",0,100);integer("Temperature",-100,100);integer("Tint",-100,100);
    if(d["speedMax"].get<int>()>d["speedMin"].get<int>())integer("Speed",d["speedMin"],d["speedMax"]);
    if(d["secondaryMax"].get<int>()>d["secondaryMin"].get<int>())integer("Slider2Val",d["secondaryMin"],d["secondaryMax"]);
    if(!e.at("UserColors").is_array()||e["UserColors"].size()!=d["colorCount"].get<size_t>())throw std::runtime_error("Invalid user color count");
    for(auto c:e["UserColors"])if(!c.is_number_integer()||c.get<int64_t>()<0||c.get<int64_t>()>0xFFFFFF)throw std::runtime_error("Invalid color");
    if(!e.at("CustomSettings").is_object())throw std::runtime_error("Invalid custom settings");
    for(auto& f:d["fields"]){auto key=f.at("key").get<std::string>();if(!e["CustomSettings"].contains(key))throw std::runtime_error("Missing setting: "+key);ValidateField(e["CustomSettings"][key],f);}
    for(auto key:{"RandomColors","AllowOnlyFirst","AutoStart","SelectAll"})if(!e.at(key).is_boolean())throw std::runtime_error("Invalid effect flag");
    if(!e.at("CustomName").is_string()||!e.at("ControllerZones").is_array())throw std::runtime_error("Invalid effect metadata");
    if(id=="Shaders")
    {
        auto& s=e["CustomSettings"];auto& p=s.at("shader_program");
        for(auto key:{"width","height"})if(!s.at(key).is_number_integer()||s[key].get<int>()<1||s[key].get<int>()>2048||p.at(key)!=s[key])throw std::runtime_error("Shader dimensions must match and be 1..2048");
        if(s.at("show_rendering")!=false)throw std::runtime_error("Native rendering window is disabled; use Electron preview");
        if(!p.at("passes").is_array()||p["passes"].size()>4)throw std::runtime_error("At most four shader channels");
        auto check=[](const json& pass){if(!pass.at("type").is_number_integer()||pass["type"].get<int>()<0||pass["type"].get<int>()>2||!pass.at("fragment_shader").is_string()||!pass.at("texture_path").is_string())throw std::runtime_error("Invalid shader pass");};
        check(p.at("main_pass"));for(auto& pass:p["passes"])check(pass);
    }
    if(id=="Layers"&&e["CustomSettings"].contains("groups"))
    {
        auto& groups=e["CustomSettings"]["groups"];
        if(!groups.is_array()||groups.size()>16)throw std::runtime_error("At most 16 layer groups");
        auto blend=[](const json& v){if(!v.is_number_integer()||v.get<int>()<0||v.get<int>()>=static_cast<int>(COLOR_BLEND_FN_NAMES.size()))throw std::runtime_error("Invalid blend mode");};
        for(auto& group:groups){blend(group.at("composer_fn"));if(!group.at("layers").is_array()||group["layers"].size()>32)throw std::runtime_error("At most 32 layers per group");for(auto& layer:group["layers"]){blend(layer.at("composer_fn"));ValidateEffect(layer.at("effect_settings"),depth+1);}}
    }
}

static json WithMissingDefaults(const json& value,const json& defaults)
{
    if(!value.is_object()||!defaults.is_object())return value;
    auto result=value;
    for(auto it=defaults.begin();it!=defaults.end();++it)
    {
        if(!result.contains(it.key()))result[it.key()]=it.value();
        else if(result[it.key()].is_object()&&it.value().is_object())result[it.key()]=WithMissingDefaults(result[it.key()],it.value());
    }
    return result;
}

static json NormalizeEffect(const json& value,int depth=0)
{
    if(depth>5)throw std::runtime_error("Layer nesting exceeds 5 levels");
    if(!value.is_object()||!value.contains("EffectClassName")||!value["EffectClassName"].is_string())throw std::runtime_error("Effect must have a valid EffectClassName");
    const std::string id=value["EffectClassName"];
    if(!descriptions.count(id))throw std::runtime_error("Unknown effect: "+id);
    auto defaults=descriptions.at(id).at("defaults");
    // A missing legacy start flag is not permission to start an imported effect.
    defaults["AutoStart"]=false;
    auto normalized=WithMissingDefaults(value,defaults);
    if(normalized["UserColors"].is_null()&&descriptions.at(id).at("colorCount")==0)normalized["UserColors"]=json::array();
    if(normalized["CustomSettings"].is_null()&&defaults["CustomSettings"].empty())normalized["CustomSettings"]=json::object();
    if(id=="Layers"&&normalized["CustomSettings"].is_object()&&normalized["CustomSettings"].contains("groups")&&normalized["CustomSettings"]["groups"].is_array())
        for(auto& group:normalized["CustomSettings"]["groups"])
            if(group.is_object()&&group.contains("layers")&&group["layers"].is_array())
                for(auto& layer:group["layers"])
                    if(layer.is_object()&&layer.contains("effect_settings"))layer["effect_settings"]=NormalizeEffect(layer["effect_settings"],depth+1);
    return normalized;
}

static json NormalizeScene(const json& value,bool validate)
{
    if(!value.is_object()||!value.contains("version")||value["version"]!=2||!value.contains("Effects")||!value["Effects"].is_array()||value["Effects"].size()>64)throw std::runtime_error("Effect scene must have version 2 and an Effects array (at most 64 entries)");
    auto result=value;
    for(auto& effect:result["Effects"])
    {
        const std::string name=effect.is_object()&&effect.contains("EffectClassName")&&effect["EffectClassName"].is_string()?effect["EffectClassName"].get<std::string>():"unnamed";
        try{effect=NormalizeEffect(effect);if(validate)ValidateEffect(effect);}
        catch(const json::exception&){throw std::runtime_error("Effect "+name+": missing or malformed setting; check its parameters");}
        catch(const std::exception& error){throw std::runtime_error("Effect "+name+": "+error.what());}
    }
    return result;
}

// Preview instances exist only in a dedicated --nodetect process. The fixture is
// private (never registered with the device list) and has no output callbacks.
// No EffectManager assignment, profile load, or UpdateLEDs call is involved.
class LumenEffectPreview final : public QObject
{
public:
    RGBControllerInterface* controller=nullptr;
    std::unique_ptr<ControllerZone> zone;
    std::unique_ptr<RGBEffect> effect;
    QTimer timer,watchdog;
    QElapsedTimer activity;
    std::string key;
    unsigned int frame=0;
    std::string failure;
    static constexpr unsigned int width=32,height=16,fps=30;

    LumenEffectPreview()
    {
        RGBController_Setup setup{};
        setup.name="Rayloom effect preview";setup.vendor="Rayloom";
        setup.description="Private software matrix; no device output";
        setup.serial="rayloom-effect-preview";setup.type=DEVICE_TYPE_VIRTUAL;
        setup.modes.resize(1);setup.modes[0].name="Direct";
        setup.modes[0].flags=MODE_FLAG_HAS_PER_LED_COLOR;
        setup.modes[0].color_mode=MODE_COLORS_PER_LED;
        setup.zones.resize(1);auto& z=setup.zones[0];
        z.name="Preview matrix";z.type=ZONE_TYPE_MATRIX;
        z.leds_count=z.leds_min=z.leds_max=width*height;
        z.matrix_map.width=width;z.matrix_map.height=height;
        z.matrix_map.map.resize(width*height);
        for(unsigned int i=0;i<width*height;i++)z.matrix_map.map[i]=i;
        controller=OpenRGBEffectsPlugin::api->CreateVirtualRGBController(&setup);
        zone=std::make_unique<ControllerZone>(controller,0,false,100,true,false);
        connect(&timer,&QTimer::timeout,this,[this](){
            if(activity.elapsed()>800){timer.stop();AudioManager::get()->StopCapture();return;}
            try{Step();}catch(const std::exception& e){failure=e.what();timer.stop();}
        });
        timer.setTimerType(Qt::PreciseTimer);
        connect(&watchdog,&QTimer::timeout,this,[this](){
            // Also bounds orphan lifetime if the editor crashes without disposal.
            if(activity.elapsed()>15000)QApplication::quit();
        });
        activity.start();watchdog.start(1000);
    }
    ~LumenEffectPreview(){Reset();zone.reset();OpenRGBEffectsPlugin::api->DeleteVirtualRGBController(controller);}
    void Reset(){timer.stop();if(effect){effect->EffectState(false);effect.reset();}AudioManager::get()->StopCapture();key.clear();frame=0;failure.clear();}
    void Step(){if(effect){effect->StepEffect({zone.get()});++frame;}}
    json Frame(const std::string& id,const json& settings,bool animate)
    {
        activity.restart();const auto next=id+settings.dump();
        if(next!=key)
        {
            Reset();std::fill_n(controller->GetZoneColorsPointer(0),width*height,0);
            effect.reset(EffectListManager::get()->GetEffectConstructor(id)());
            effect->SetAutoStart(false);effect->SetFPS(fps);
            effect->SetUserColors(settings.at("UserColors").get<std::vector<RGBColor>>());
            effect->SetSpeed(settings.at("Speed"));effect->SetSlider2Val(settings.at("Slider2Val"));
            effect->SetRandomColorsEnabled(settings.at("RandomColors"));
            effect->SetOnlyFirstColorEnabled(settings.at("AllowOnlyFirst"));
            effect->SetBrightness(settings.at("Brightness"));effect->SetTemperature(settings.at("Temperature"));effect->SetTint(settings.at("Tint"));
            effect->LoadCustomSettings(settings.at("CustomSettings"));
            effect->OnControllerZonesListChanged({zone.get()});effect->EffectState(true);key=next;
            // A bounded warm-up gives iterative effects a meaningful thumbnail.
            // Clock-based algorithms still use their real clock, not a substitute.
            for(unsigned int i=0;i<fps*2;i++)Step();
        }
        if(!failure.empty())throw std::runtime_error(failure);
        if(animate){if(!timer.isActive())timer.start(1000/fps);}else timer.stop();
        json colors=json::array();for(unsigned int i=0;i<width*height;i++)colors.push_back(controller->GetZoneColor(0,i));
        json result={{"status","ready"},{"source","native"},{"effectId",id},{"width",width},{"height",height},{"colors",colors},{"frame",frame},{"fps",fps},{"settings",settings}};
        if(settings["CustomSettings"].contains("audio_settings"))result["input"]=AudioManager::get()->CaptureStatus(settings["CustomSettings"]["audio_settings"]["audio_device"]);
        return result;
    }
};
static std::unique_ptr<LumenEffectPreview> effect_preview;
void LumenEffectsPreviewStop(){effect_preview.reset();}

static json PreviewCommand(const json& request)
{
    if(qEnvironmentVariable("RAYLOOM_EFFECT_PREVIEW")!="1"||qEnvironmentVariable("RAYLOOM_VIRTUAL_DEVICE")!="1")
        throw std::runtime_error("Effect previews require an isolated virtual preview process");
    if(request.at("method")=="preview.stop"){if(effect_preview)effect_preview->Reset();return true;}
    const std::string id=request.at("effectId");
    if(!descriptions.count(id))throw std::runtime_error("Unknown preview effect");
    const auto& description=descriptions.at(id);
    std::string reason;
    if(description.at("category")=="Audio"&&!request.value("animate",true))
    {
        if(effect_preview)effect_preview->Reset();
        return {{"status","needs-input"},{"source","native"},{"effectId",id},{"reason","audio-hover"},{"input",{{"kind","audio"},{"status","idle"},{"peak",0}}}};
    }
    if(id=="Ambient")reason="screen";
    else if(id=="GIFPlayer")reason="image";
    else if(id=="Shaders")reason="shader";
    else if(id=="Layers")reason="layers";
    else if(id=="CustomBlink")reason="sequence";
    if(!reason.empty())
    {
        if(effect_preview)effect_preview->Reset();
        return {{"status","needs-input"},{"source","native"},{"effectId",id},{"reason",reason}};
    }
    auto settings=NormalizeEffect(request.at("settings"));
    if(description.at("category")=="Audio"&&request.value("audioAutomatic",false))settings["CustomSettings"]["audio_settings"]["audio_device"]=AudioManager::get()->DefaultLoopbackDevice();
    if(settings.at("EffectClassName")!=id)throw std::runtime_error("Preview settings do not match effect");
    ValidateEffect(settings);
    if(!effect_preview)effect_preview=std::make_unique<LumenEffectPreview>();
    return effect_preview->Frame(id,settings,request.value("animate",true));
}

json LumenEffectsCommand(OpenRGBEffectTab* tab,const json& request)
{
    auto method=request.at("method").get<std::string>();
    if(catalog.is_null())
    {
        catalog=json::array();
        for(auto& category:EffectListManager::get()->GetCategorizedEffects())for(auto& item:category.second)
        {
            auto d=Describe(item.classname,category.first);descriptions[item.classname]=d;catalog.push_back(d);
        }
    }
    if(method=="preview.frame"||method=="preview.stop")return PreviewCommand(request);
    if(method=="audio.status")return AudioManager::get()->CaptureStatus(request.value("deviceIndex",AudioManager::get()->DefaultLoopbackDevice()));
    if(method=="catalog")
    {
        // Start the orphan watchdog even when the only requested previews need
        // external input and therefore never instantiate an effect.
        if(qEnvironmentVariable("RAYLOOM_EFFECT_PREVIEW")=="1"&&qEnvironmentVariable("RAYLOOM_VIRTUAL_DEVICE")=="1"&&!effect_preview)
            effect_preview=std::make_unique<LumenEffectPreview>();
        const int audio_default=AudioManager::get()->DefaultLoopbackDevice();
        for(auto& item:catalog)if(item["category"]=="Audio"){item["audioDefaultDevice"]=audio_default;descriptions[item["id"]]["audioDefaultDevice"]=audio_default;}
        return catalog;
    }
    if(method=="diagnostics"){json result=json::array();for(auto* shader:tab->findChildren<Shaders*>())result.push_back(shader->LumenPreview());return result;}
    if(method=="shader.save"){
        auto name=request.at("name").get<std::string>();if(name.empty()||name.size()>100||name.find_first_of("/\\:*?\"<>|")!=std::string::npos||name=="."||name=="..")throw std::runtime_error("Invalid shader name");
        if(!OpenRGBEffectSettings::SaveShader(request.at("program").dump(2),name))throw std::runtime_error("Cannot save shader");return true;
    }
    if(method=="scene.get")return NormalizeScene(tab->GetProfileJson(true),false);
    if(method=="scene.validate")return NormalizeScene(request.at("profile"),true);
    if(method=="scene.apply")
    {
        auto profile=NormalizeScene(request.at("profile"),true);
        const auto previous=NormalizeScene(tab->GetProfileJson(true),false);
        tab->LoadProfileJson(profile);auto loaded=NormalizeScene(tab->GetProfileJson(true),false);
        if(loaded["Effects"].size()!=profile["Effects"].size()){tab->LoadProfileJson(previous);throw std::runtime_error("An effect failed to load; the previous scene was restored. Inspect core.log");}return loaded;
    }
    if(method=="stop"){tab->StopAll();return true;}
    if(method=="start"){tab->StartAll();return true;}
    if(method=="screen.capture") {
        const auto screens=QApplication::screens();int index=request.at("index").get<int>();
        if(index<0||index>=screens.size())throw std::runtime_error("Screen not found");
        QImage frame=screens[index]->grabWindow(0).toImage();if(frame.isNull())throw std::runtime_error("Screen capture unavailable");
        QByteArray bytes;QBuffer buffer(&bytes);buffer.open(QIODevice::WriteOnly);frame.scaled(1000,600,Qt::KeepAspectRatio,Qt::SmoothTransformation).save(&buffer,"JPG",75);
        return {{"width",frame.width()},{"height",frame.height()},{"image","data:image/jpeg;base64,"+bytes.toBase64().toStdString()}};
    }
    if(method=="screens")
    {
        json result=json::array();int index=0;
        for(auto* screen:QApplication::screens()){auto r=screen->geometry();result.push_back({{"index",index++},{"name",screen->name().toStdString()},{"x",r.x()},{"y",r.y()},{"width",qRound(r.width()*screen->devicePixelRatio())},{"height",qRound(r.height()*screen->devicePixelRatio())}});}return result;
    }
    if(method=="shaders")
    {
        json result=json::array();QDirIterator it(":/shaders");
        while(it.hasNext()){auto p=it.next();result.push_back({{"path",p.toStdString()},{"name",p.split('/').last().toStdString()}});}
        for(auto& p:OpenRGBEffectSettings::ListShaders())result.push_back({{"path",p},{"name",filesystem::path(p).filename().string()}});
        return result;
    }
    if(method=="shader.read")
    {
        auto p=request.at("path").get<std::string>();
        bool allowed=p.rfind(":/shaders/",0)==0;
        for(auto& file:OpenRGBEffectSettings::ListShaders())if(file==p)allowed=true;
        if(!allowed)throw std::runtime_error("Shader is not in library");
        QFile f(QString::fromStdString(p));if(!f.open(QIODevice::ReadOnly))throw std::runtime_error("Cannot read shader");
        return json::parse(f.readAll().toStdString());
    }
    if(method=="blendModes")return COLOR_BLEND_FN_NAMES;
    if(method=="globals.get"||method=="globals.set")
    {
        auto& g=OpenRGBEffectSettings::globalSettings;
        json value;
#define LUMEN_GLOBAL_FIELDS(X) X(fpscapture) X(fps) X(brightness) X(temperature) X(tint) X(hide_unsupported) X(prefer_random) X(use_prefered_colors) X(startup_timeout) X(prefered_colors) X(audio_settings)
#define READ_FIELD(k) value[#k]=g.k;
        LUMEN_GLOBAL_FIELDS(READ_FIELD)
#undef READ_FIELD
        json fields=json::array();for(auto it=value.begin();it!=value.end();++it)fields.push_back(Field(it.key(),it.value(),nullptr,json::object()));
        if(method=="globals.set")
        {
            value=request.at("settings");for(auto& f:fields)ValidateField(value.at(f.at("key").get<std::string>()),f);
            auto previous=g;
#define WRITE_FIELD(k) g.k=value.at(#k).get<decltype(g.k)>();
            LUMEN_GLOBAL_FIELDS(WRITE_FIELD)
#undef WRITE_FIELD
            if(!OpenRGBEffectSettings::WriteGlobalSettings()){g=previous;throw std::runtime_error("Cannot save global settings");}
        }
        return {{"value",value},{"fields",fields}};
    }
    throw std::runtime_error("Unknown Effects method");
}
