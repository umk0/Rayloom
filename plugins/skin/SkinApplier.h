#ifndef SKINAPPLIER_H
#define SKINAPPLIER_H

#include <QWidget>
#include <QString>
#include <QComboBox>

namespace Ui {
class SkinApplier;
}

class SkinApplier : public QWidget
{
    Q_OBJECT

public:
    explicit SkinApplier(QWidget *parent = nullptr);
    ~SkinApplier();

    void SetSkin(std::string);

    /*-----------------------------------------------------*\
    | Read skins.json and restore the startup skin, whether  |
    | it is enabled, and apply the skin if it is             |
    \*-----------------------------------------------------*/
    void RestoreSettings();

private slots:
    void on_open_skin_file_clicked();
    void on_skins_list_activated(int /*index*/);
    void on_startup_skins_list_activated(int /*index*/);
    void on_open_skins_folder_clicked();
    void on_load_at_startup_stateChanged(int);

private:
    void ApplySkin(QString);
    void ApplySystemTheme();
    void ApplyFusionTheme();
    void ApplyDefaultStyle();
    void ApplySystemStyle();

    /*-----------------------------------------------------*\
    | Apply a skin from an arbitrary path on disk and copy  |
    | it into the skins folder so it is added to the list,  |
    | can be re-applied, and can be loaded at startup       |
    \*-----------------------------------------------------*/
    void InstallSkinFromFile(QString);

    /*-----------------------------------------------------*\
    | Add a skin to both lists if it is not already in them |
    | and make it the active entry.  setCurrentIndex() does |
    | not emit activated(), so this cannot re-trigger        |
    | applying                                               |
    \*-----------------------------------------------------*/
    void AddSkinToList(QString);

    /*-----------------------------------------------------*\
    | Populate a combobox with the built-in themes and every |
    | skin in the skins folder                               |
    \*-----------------------------------------------------*/
    void PopulateSkinsList(QComboBox*);

    /*-----------------------------------------------------*\
    | Persist the startup checkbox and combobox selection    |
    \*-----------------------------------------------------*/
    void SaveStartupSettings();

    Ui::SkinApplier *ui;
    QApplication *app;

    /*-----------------------------------------------------*\
    | Name of the skin that is currently applied, used to   |
    | persist the skin if it is saved to load at startup    |
    \*-----------------------------------------------------*/
    QString active_skin_name;
};

#endif // SKINAPPLIER_H
