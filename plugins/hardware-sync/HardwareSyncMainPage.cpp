#include "HardwareSyncMainPage.h"
#include "OpenRGBHardwareSyncPlugin.h"
#include "../LumenProtocol.h"
#include <fstream>
#include "TabHeader.h"
#include <QToolButton>
#include <QMainWindow>
#include <QAction>
#include <QMenu>
#include <QDialog>
#include <QTimer>

HardwareSyncMainPage::HardwareSyncMainPage(QWidget *parent) :
    QWidget(parent),
    ui(new Ui::HardwareSyncMainPage)
{
    ui->setupUi(this);
    QTimer::singleShot(0, this, [this](){
        try {
            auto file=OpenRGBHardwareSyncPlugin::api->GetConfigurationDirectory()/"plugins"/"settings"/"LumenHardware.json";
            std::ifstream in(file); if(in) { json list; in >> list; LumenCommand({{"method","config.set"},{"measures",list}}); }
        } catch(const std::exception& e) { qWarning("Hardware Sync settings: %s",e.what()); }
    });

    /*-----------------------------------------------------*\
    | Remove intial dummy tabs                              |
    \*-----------------------------------------------------*/
    ui->tabs->clear();

    /*-----------------------------------------------------*\
    | Define tab style + settings                           |
    \*-----------------------------------------------------*/
    ui->tabs->setTabsClosable(true);
    ui->tabs->tabBar()->setStyleSheet("QTabBar::tab:hover {text-decoration: underline;}");

    QMenu* main_menu = new QMenu(this);

    QLabel* no_measure = new QLabel("You have no measure.\n You can add one by clicking the HWSync button.");
    no_measure->setAlignment(Qt::AlignCenter);

    /*-----------------------------------------------------*\
    | First tab: add button                                 |
    \*-----------------------------------------------------*/
    QPushButton* main_menu_button = new QPushButton();
    main_menu_button->setText("HWSync");
    ui->tabs->addTab(no_measure, QString(""));
    ui->tabs->tabBar()->setTabButton(0, QTabBar::RightSide, main_menu_button);
    ui->tabs->setTabEnabled(0, false);
    main_menu_button->setMenu(main_menu);

    QAction* new_measure = new QAction("New measure", this);
    connect(new_measure, &QAction::triggered, this, &HardwareSyncMainPage::AddTabSlot);
    main_menu->addAction(new_measure);

    for(QWidget *w : QApplication::topLevelWidgets())
    {
        if(QMainWindow* mainWin = qobject_cast<QMainWindow*>(w))
        {
            QAction* actionLightsOff = mainWin->findChild<QAction *>("ActionLightsOff");

            if(actionLightsOff)
            {
                connect(actionLightsOff, SIGNAL(triggered()), this, SLOT(OnStopMeasures()));
                break;
            }
        }
    }
}

HardwareSyncMainPage::~HardwareSyncMainPage()
{
    delete ui;
}

void HardwareSyncMainPage::AddTabSlot()
{
    AddMeasure(new MeasureEntry(this));
}

void HardwareSyncMainPage::StopAll()
{
    for(MeasureEntry* measure: measures)
    {
        measure->Stop();
    }
}

void HardwareSyncMainPage::Clear()
{
    StopAll();

    while(!measures.empty())
    {
        MeasureEntry* measure = measures.back();
        int tab_idx = ui->tabs->indexOf(measure);
        if(tab_idx >= 0)
        {
            ui->tabs->removeTab(tab_idx);
        }
        measures.pop_back();
        delete measure;
    }
}

void HardwareSyncMainPage::LoadMeasures(json measure_list)
{
    for(json measure : measure_list)
    {
        AddMeasure(MeasureEntry::FromJson(this, measure));
    }
}

json HardwareSyncMainPage::LumenCommand(const json& r)
{
 auto method=r.at("method").get<std::string>();auto hardware=OpenRGBHardwareSyncPlugin::hm->GetAvailableDevices();
 if(method=="config.set"){
  auto list=r.at("measures");if(!list.is_array()||list.size()>64)throw std::runtime_error("At most 64 measures");
  for(auto& m:list){lumen::Name(m.at("name"));lumen::Number(m,"fps",1,240);lumen::Number(m,"brightness",0,100);lumen::Number(m,"refresh_interval",10,60000);lumen::Number(m,"hardware",0,static_cast<int>(hardware.size())-1);lumen::Number(m,"hardware_feature",0,static_cast<int>(hardware.at(m["hardware"].get<size_t>()).features.size())-1);m["hardware_identifier"]=hardware[m["hardware"].get<size_t>()].features[m["hardware_feature"].get<size_t>()].Identifier;
   auto& stops=m.at("measure_color").at("color_stops");if(!stops.is_array()||stops.empty()||stops.size()>64)throw std::runtime_error("Invalid gradient");double last=-1e99;for(auto& s:stops){if(!s.is_array()||s.size()!=2||!s[0].is_number()||s[0].get<double>()<=last||!s[1].is_number_integer()||s[1].get<int64_t>()<0||s[1].get<int64_t>()>0xffffff)throw std::runtime_error("Gradient stops must be ordered and unique");last=s[0].get<double>();}
   if(!m.at("running").is_boolean()||!m.at("devices").is_array())throw std::runtime_error("Invalid measure state");
  }
  Clear();LoadMeasures(list);
  auto file=OpenRGBHardwareSyncPlugin::api->GetConfigurationDirectory()/"plugins"/"settings"/"LumenHardware.json";std::ofstream out(file);out<<list.dump(2);if(!out)throw std::runtime_error("Cannot save measures");
 } else if(method=="stop")StopAll();
 else if(method=="start"){for(auto* m:measures)m->Start();}
 else if(method!="config.get")throw std::runtime_error("Unknown hardware method");
 json list=json::array();for(auto* m:measures)list.push_back(m->ToJson());
 json sensors=json::array();for(auto& h:hardware){json features=json::array();for(auto& f:h.features)features.push_back({{"name",f.Name},{"identifier",f.Identifier}});sensors.push_back({{"name",h.TrackDeviceName},{"features",features}});}
 json values=json::array();for(auto* m:measures){auto* label=m->findChild<QLabel*>("measure");values.push_back(label?label->text().toStdString():"");}
 return {{"measures",list},{"hardware",sensors},{"values",values},{"virtual",qEnvironmentVariable("LUMEN_VIRTUAL_DEVICE")=="1"}};
}

std::vector<MeasureEntry*> HardwareSyncMainPage::GetMeasures()
{
    return measures;
}

void HardwareSyncMainPage::InitDevicesList()
{
    for(MeasureEntry* measure: measures)
    {
        measure->InitDevicesList();
    }
}

void HardwareSyncMainPage::RefreshDevicesLists()
{
    /*-----------------------------------------------------*\
    | Save the running state and the enabled devices of     |
    | each measure before refreshing                        |
    \*-----------------------------------------------------*/
    std::vector<bool> was_running;
    std::vector<json> saved_devices;

    for(MeasureEntry* measure: measures)
    {
        was_running.push_back(measure->IsRunning());
        saved_devices.push_back(measure->SaveDevices());
    }
    
    /*-----------------------------------------------------*\
    | Stop all measures temporarily to safely clear and     |
    | reinitialize device lists                             |
    \*-----------------------------------------------------*/
    StopAll();
    
    for(MeasureEntry* measure: measures)
    {
        measure->Clear();
        measure->InitDevicesList();
    }
    
    /*-----------------------------------------------------*\
    | Restore the enabled devices and the running state     |
    | after the list update is complete                     |
    \*-----------------------------------------------------*/
    for(size_t i = 0; i < measures.size(); ++i)
    {
        measures[i]->LoadDevices(saved_devices[i]);

        if(was_running[i])
        {
            measures[i]->Start();
        }
    }
}

void HardwareSyncMainPage::CloseMeasure(MeasureEntry* measure_entry_tab)
{
    int tab_idx = ui->tabs->indexOf(measure_entry_tab);

    ui->tabs->removeTab(tab_idx);

    measures.erase(std::find(measures.begin(), measures.end(), measure_entry_tab));

    delete measure_entry_tab;
}

void HardwareSyncMainPage::AddMeasure(MeasureEntry* measure_entry_tab)
{    
    int tab_size = ui->tabs->count();

    /*-----------------------------------------------------*\
    | Insert at the end                                     |
    \*-----------------------------------------------------*/
    int tab_position = tab_size;

    std::string tab_name = measure_entry_tab->GetName();

    TabHeader* tab_header = new TabHeader();
    tab_header->Rename(QString::fromUtf8(tab_name.c_str()));

    measure_entry_tab->Rename(tab_name);

    ui->tabs->insertTab(tab_position, measure_entry_tab , "");
    ui->tabs->tabBar()->setTabButton(tab_position, QTabBar::RightSide, tab_header);

    connect(measure_entry_tab, &MeasureEntry::MeasureState, [=](bool state){
        tab_header->ToogleRunningIndicator(state);
    });

    ui->tabs->setCurrentIndex(tab_position);

    connect(measure_entry_tab, &MeasureEntry::Renamed, [=](std::string new_name){
        tab_header->Rename(QString::fromUtf8(new_name.c_str()));
    });

    connect(tab_header, &TabHeader::RenameRequest, [=](QString new_name){
        measure_entry_tab->Rename(new_name.toStdString());
    });

    connect(tab_header, &TabHeader::CloseRequest, [=](){
        int tab_idx = ui->tabs->indexOf(measure_entry_tab);

        ui->tabs->removeTab(tab_idx);

        measures.erase(std::find(measures.begin(), measures.end(), measure_entry_tab));

        delete measure_entry_tab;
        delete tab_header;
    });

    connect(tab_header, &TabHeader::StartStopRequest, [=](){

        if(measure_entry_tab->IsRunning())
        {
            measure_entry_tab->Stop();
        }
        else
        {
            measure_entry_tab->Start();
        }
    });

    tab_header->ToogleRunningIndicator(measure_entry_tab->IsRunning());

    ui->tabs->update();

    measures.push_back(measure_entry_tab);
}

void HardwareSyncMainPage::on_start_stop_all_clicked()
{
    if(HasStartedMeasures())
    {
        for(MeasureEntry* measure: measures)
        {
            measure->Stop();
        }
    }

    else
    {
        for(MeasureEntry* measure: measures)
        {
            measure->Start();
        }
    }

}

bool HardwareSyncMainPage::HasStartedMeasures()
{
    for(MeasureEntry* measure: measures)
    {
        if(measure->IsRunning())
            return true;
    }

    return false;
}

void HardwareSyncMainPage::OnStopMeasures()
{
    for(MeasureEntry* measure: measures)
    {
        measure->Stop();
    }
}
