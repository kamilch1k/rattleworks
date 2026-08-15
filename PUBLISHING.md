# Rattleworks publishing checklist

The current release is a single universal HTML5 build. It stays English on CrazyGames and switches to Russian automatically on a Yandex Games host. The Yandex SDK is loaded from `/sdk.js`; the CrazyGames SDK is loaded from the CrazyGames host.

## Files to upload

- CrazyGames: `outputs/rattleworks-crazygames-<commit>.zip`
- Yandex Games: `outputs/rattleworks-yandex-ru-<commit>.zip`
- Cover/screenshots: `outputs/rattleworks-campaign.png`, `outputs/rattleworks-menu.png`, and `outputs/rattleworks-sandbox.png`
- Russian Yandex screenshots: `outputs/rattleworks-yandex-ru-menu.png` and `outputs/rattleworks-yandex-ru-campaign.png`

Each portal archive contains the contents of `dist/` at its archive root, including `index.html` and the hashed `assets/` folder. Do not upload the source archive or the repository folder.

## CrazyGames copy

Title: `Rattleworks`

Short description: `A 3D physics destruction playground: launch heavy balls, tank shells, bombs, rockets and firearms, then drag the wreckage and ragdolls.`

Instructions: `Click or tap a world point to launch the selected item. Drag props and ragdolls with the left mouse button. Use the right mouse button to orbit the camera. Press F to fire or launch, R to reload firearms, and Space to pause.`

Suggested category: `Action` or `Simulation`.

## Yandex Games copy (Russian)

Название: `Rattleworks: Физический хаос`

Краткое описание: `3D-песочница разрушений: запускайте тяжёлые шары, танковые снаряды, бомбы, ракеты и оружие, а затем перетаскивайте обломки и персонажей.`

Инструкция: `Нажмите на точку мира, чтобы запустить выбранный предмет. Перетаскивайте предметы и персонажей левой кнопкой мыши. Вращайте камеру правой кнопкой. Клавиша F запускает предмет или оружие, R перезаряжает оружие, пробел ставит игру на паузу.`

Жанр: `Экшен` / `Симулятор`.

## Minimum-click submission flow

### CrazyGames

1. Open [CrazyGames Developer Portal](https://developer.crazygames.com/) and choose **Submit my game**.
2. Create the game, upload the CrazyGames zip, add the title/description/instructions above, and upload the 1280×720 campaign image as the cover.
3. Use **Preview** to test the menu, Level 1, shooting, dragging, pause, and mobile layout.
4. Submit for the initial QA/basic launch. CrazyGames uses a Basic Launch followed by a wider Full Launch review.

### Yandex Games

1. Open [Yandex Games Console](https://games.yandex.com/developers/) and choose **Add app**.
2. Upload the Yandex zip as a new draft. Keep `index.html` at the archive root; Yandex serves `/sdk.js` for the required SDK loader.
3. Select Russian as the localization language and paste the Russian metadata above. Use screenshots without English text.
4. Test the draft with the Yandex debug panel, then choose **Submit for moderation**. Yandex says moderation usually takes 3–5 business days.

Yandex requires the SDK for publication and requires title, description, instructions, and any text in promotional media to match the selected localization. At startup the game reads `ysdk.environment.i18n.lang`; Russian is the declared localization and unsupported portal languages fall back to Russian. The runtime Russian mode and SDK loader are already included in this release.
