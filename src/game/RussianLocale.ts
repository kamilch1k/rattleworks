import { platformService } from './PlatformService';

const TERMS: Record<string, string> = {
  'RATTLEWORKS': 'RATTLEWORKS',
  '3D PHYSICS DESTRUCTION': '3D ФИЗИЧЕСКОЕ РАЗРУШЕНИЕ',
  'Aim. Launch. Drag the wreckage.': 'ЦЕЛЬТЕСЬ. ЗАПУСКАЙТЕ. ТАЩИТЕ ОБЛОМКИ.',
  'PLAY LEVELS': 'ИГРАТЬ В УРОВНИ',
  'Launch shots. Topple targets.': 'Запускайте снаряды. Роняйте цели.',
  'Experimental build lab': 'Экспериментальная лаборатория',
  'WIP': 'В РАЗРАБОТКЕ',
  'Click a world point to launch': 'Нажмите точку мира для запуска',
  'Then drag anything': 'Затем тащите всё',
  'Local': 'Локально',
  'OPENING THE TOY CRATE': 'ОТКРЫВАЕМ ЯЩИК ИГРУШЕК',
  'RATTLEWORKS LAB': 'ЛАБОРАТОРИЯ RATTLEWORKS',
  'CAMPAIGN': 'КАМПАНИЯ',
  'SANDBOX': 'ПЕСОЧНИЦА',
  'CAMPAIGN BUILD': 'СБОРКА КАМПАНИИ',
  'MAIN MENU': 'ГЛАВНОЕ МЕНЮ',
  'Main menu': 'Главное меню',
  'LEVELS': 'УРОВНИ',
  '12 PHYSICS DESTRUCTION LEVELS': '12 УРОВНЕЙ ФИЗИЧЕСКОГО РАЗРУШЕНИЯ',
  'CHOOSE A LEVEL': 'ВЫБЕРИТЕ УРОВЕНЬ',
  'CHAPTER': 'ГЛАВА',
  'PREVIEW PENDING': 'ПРЕДПРОСМОТР ГОТОВИТСЯ',
  'LOCKED': 'ЗАКРЫТО',
  'Locked': 'Закрыто',
  'New': 'Новое',
  'Best': 'Рекорд',
  'of': 'из',
  'Backyard Mayhem': 'Хаос на заднем дворе',
  'Machine Trouble': 'Машинные неприятности',
  'Big Mess': 'Большой беспорядок',
  'BACK': 'НАЗАД',
  'PLAY': 'ИГРАТЬ',
  'CONTINUE': 'ПРОДОЛЖИТЬ',
  'START': 'СТАРТ',
  'RESET': 'СБРОСИТЬ',
  'RETRY': 'ЗАНОВО',
  'RETRY NOW ↺': 'ЗАНОВО ↺',
  'NEXT LEVEL →': 'СЛЕДУЮЩИЙ УРОВЕНЬ →',
  'CAMPAIGN COMPLETE →': 'КАМПАНИЯ ЗАВЕРШЕНА →',
  'PAUSED': 'ПАУЗА',
  'RESUME ▶': 'ПРОДОЛЖИТЬ ▶',
  'MENU': 'МЕНЮ',
  'QUALITY': 'КАЧЕСТВО',
  'Fastest': 'Быстро',
  'Balanced': 'Баланс',
  'Best shadows': 'Лучшие тени',
  'MASTER VOLUME': 'ОБЩАЯ ГРОМКОСТЬ',
  'CAMERA SHAKE': 'ТРЯСКА КАМЕРЫ',
  'SETTINGS': 'НАСТРОЙКИ',
  'RATTLEWORKS OPTIONS': 'НАСТРОЙКИ RATTLEWORKS',
  'POWER': 'СИЛА',
  'TIME': 'ВРЕМЯ',
  'TARGETS': 'ЦЕЛИ',
  'BODIES': 'ТЕЛА',
  'BODY': 'ТЕЛО',
  'ACTIVE': 'АКТИВНЫЕ',
  'SLEEP': 'СПЯЩИЕ',
  'ITEMS': 'ПРЕДМЕТЫ',
  'ITEMS USED': 'ПРЕДМЕТЫ ИСПОЛЬЗОВАНЫ',
  'DESTRUCTION': 'РАЗРУШЕНИЕ',
  'SCORE': 'СЧЁТ',
  'STARS': 'ЗВЁЗДЫ',
  'GRAB': 'ХВАТАТЬ',
  'SELECTED': 'ВЫБРАНО',
  'READY': 'ГОТОВО',
  'FIRE': 'ОГОНЬ',
  'LAUNCH': 'ЗАПУСК',
  'DROP': 'БРОСИТЬ',
  'FIRE HERE': 'СТРЕЛЯТЬ СЮДА',
  'LAUNCH HERE': 'ЗАПУСТИТЬ СЮДА',
  'CLICK TO LAUNCH HERE': 'НАЖМИТЕ ТОЧКУ ДЛЯ ЗАПУСКА',
  'CLICK TO FIRE HERE': 'НАЖМИТЕ ТОЧКУ ДЛЯ ОГНЯ',
  'CLICK TO USE WEAPON': 'НАЖМИТЕ ТОЧКУ ДЛЯ ОРУЖИЯ',
  'CLICK A WORLD POINT TO LAUNCH': 'НАЖМИТЕ ТОЧКУ МИРА ДЛЯ ЗАПУСКА',
  'CLICK A WORLD POINT TO FIRE': 'НАЖМИТЕ ТОЧКУ МИРА ДЛЯ ОГНЯ',
  'CLICK A WORLD POINT TO USE': 'НАЖМИТЕ ТОЧКУ МИРА ДЛЯ ИСПОЛЬЗОВАНИЯ',
  'WORK IN PROGRESS': 'В РАЗРАБОТКЕ',
  'EXPERIMENTAL MODE': 'ЭКСПЕРИМЕНТАЛЬНЫЙ РЕЖИМ',
  'SANDBOX LAB': 'ЛАБОРАТОРИЯ ПЕСОЧНИЦЫ',
  'ITEM SHOP': 'МАГАЗИН ПРЕДМЕТОВ',
  'EXPERIMENTAL STOCK': 'ЭКСПЕРИМЕНТАЛЬНЫЙ СКЛАД',
  'FAVORITES': 'ИЗБРАННОЕ',
  'RECENT': 'НЕДАВНИЕ',
  'SEARCH THE SHELVES...': 'ПОИСК ПО ПОЛКАМ...',
  'SELECT AN ITEM': 'ВЫБЕРИТЕ ПРЕДМЕТ',
  'THE SHELF IS READY': 'ПОЛКА ГОТОВА',
  'SPAWN / DROP': 'СОЗДАТЬ / БРОСИТЬ',
  'AT CAMERA TARGET': 'В ТОЧКЕ КАМЕРЫ',
  'NO FAVORITES YET': 'ИЗБРАННОГО НЕТ',
  'NOTHING DROPPED YET': 'ЕЩЁ НИЧЕГО НЕ БРОШЕНО',
  'NO MATCHES': 'НЕТ СОВПАДЕНИЙ',
  'PAUSE': 'ПАУЗА',
  'UNDO': 'ОТМЕНИТЬ',
  'REDO': 'ПОВТОРИТЬ',
  'SAVE': 'СОХРАНИТЬ',
  'LOAD': 'ЗАГРУЗИТЬ',
  'BLUEPRINT': 'ЧЕРТЁЖ',
  'CLEAR': 'ОЧИСТИТЬ',
  'DELETE': 'УДАЛИТЬ',
  'FREEZE': 'ЗАМОРОЗИТЬ',
  'ROTATE': 'ВРАЩАТЬ',
  'PUSH': 'ТОЛКАТЬ',
  'EXPLOSION': 'ВЗРЫВ',
  'CONNECT': 'СОЕДИНИТЬ',
  'ROPE': 'ВЕРЁВКА',
  'SPRING': 'ПРУЖИНА',
  'HINGE': 'ПЕТЛЯ',
  'MOTOR': 'МОТОР',
  'DUPLICATE': 'ДУБЛИРОВАТЬ',
  'LEFT DRAG · GRAB BODY PARTS': 'ЛЕВАЯ КНОПКА · ХВАТАТЬ ЧАСТИ ТЕЛА',
  'RIGHT DRAG · ORBIT': 'ПРАВАЯ КНОПКА · ВРАЩАТЬ КАМЕРУ',
  'MIDDLE / SHIFT DRAG · PAN': 'СРЕДНЯЯ / SHIFT · ПЕРЕМЕЩАТЬ КАМЕРУ',
  'WHEEL / PINCH · ZOOM': 'КОЛЕСО / ЩИПОК · МАСШТАБ',
  'WASD · MOVE FOCUS': 'WASD · ДВИГАТЬ ФОКУС',
  'F · FIRE OR PLACE': 'F · СТРЕЛЯТЬ ИЛИ РАЗМЕЩАТЬ',
  'SPACE · PAUSE': 'ПРОБЕЛ · ПАУЗА',
  'F3 · LAB STATS': 'F3 · СТАТИСТИКА',
  'Heavy Ball': 'Тяжёлый шар',
  'Metal Ball': 'Металлический шар',
  'Concrete Chunk': 'Кусок бетона',
  'Tank Shell': 'Танковый снаряд',
  'Pistol Shot': 'Пистолет',
  'Shotgun Blast': 'Дробовик',
  'Rifle Round': 'Винтовка',
  'Toy Bomb': 'Игрушечная бомба',
  'Thrown Bomb': 'Брошенная бомба',
  'Rocket': 'Ракета',
  'Utility Knife': 'Нож',
  'Block Machete': 'Мачете',
  'Fire Axe': 'Пожарный топор',
  'Yard Spear': 'Копьё',
  'Knock Knock': 'Тук-тук',
  'Three targets. Four stones. One flimsy hut.': 'Три цели. Четыре камня. Один хлипкий домик.',
  'Punch through the doorway, clip a corner post, or drop the roof onto every target.': 'Пробейте дверь, зацепите угловую стойку или сбросьте крышу на все цели.',
  'Use no more than 2 heavy balls': 'Используйте не более 2 тяжёлых шаров',
  'Finish in 35 seconds': 'Завершите за 35 секунд',
  'Heavy Ball Pair': 'Пара тяжёлых шаров',
  'Bad Foundation': 'Плохой фундамент',
  'A tall stack, three stone balls, and one concrete chunk.': 'Высокая башня, три каменных шара и кусок бетона.',
  'Launch the concrete chunk through a footing or hit either red blast pocket to fold the occupied tower sideways.': 'Запустите кусок бетона в основание или ударьте по красной взрывной нише, чтобы завалить башню.',
  'Topple the tower in 50 seconds': 'Свалите башню за 50 секунд',
  'Break at least 55% of the tower': 'Разрушьте не менее 55% башни',
  'Barrel Trouble': 'Бочковая проблема',
  'A wall, two drums, and a parked battering ram.': 'Стена, две бочки и припаркованный таран.',
  'Detonate a front drum, drive the loose car into the screen, or punch a clean hole through the blocks.': 'Взорвите переднюю бочку, врежьте машиной в стену или пробейте отверстие в блоках.',
  'Use at most 2 items': 'Используйте не более 2 предметов',
  'Clear the wall in 40 seconds': 'Очистите стену за 40 секунд',
  'Domino House': 'Домино-дом',
  'Three frames, one car, and a chain-reaction pocket.': 'Три рамы, одна машина и ниша для цепной реакции.',
  'Launch the parked car into the first frame or blow the shared gap so the row collapses in either direction.': 'Врежьте машиной в первую раму или взорвите общий зазор, чтобы ряд рухнул.',
  'Start the chain with only 1 item': 'Начните цепь только с 1 предметом',
  'Finish in 45 seconds': 'Завершите за 45 секунд',
  'Spring Cleaning': 'Весенняя уборка',
  'A stepped ricochet range with a red finish line.': 'Ступенчатый тир с красной финишной линией.',
  'Bank metal and rubber balls through the three stands, or detonate the drum beside the backstop.': 'Отбивайте металлические и резиновые шары через три стойки или взорвите бочку у щита.',
  'Use no more than 5 pieces': 'Используйте не более 5 деталей',
  'Clean the range in 60 seconds': 'Очистите тир за 60 секунд',
  'Wrecking Ball': 'Шар разрушения',
  'One hanging weight, one workshop, one loaded truck.': 'Один подвешенный груз, мастерская и загруженный грузовик.',
  'Drive a shot into the weight, the frame supports, or the truck cargo and follow the aftermath by hand.': 'Попадите в груз, опоры рамы или кузов грузовика и завершите разрушение вручную.',
  'Use only 1 loadout item': 'Используйте только 1 предмет',
  'Land the swing in 45 seconds': 'Попадите грузом за 45 секунд',
  'Delivery Problem': 'Проблема доставки',
  'The truck is built. The depot gate is not ready.': 'Грузовик готов. Ворота склада — нет.',
  'Launch the parked truck through the gate, pop its cargo, or break either gatepost with a direct shot.': 'Протащите грузовик через ворота, взорвите груз или сломайте стойку прямым попаданием.',
  'Make the delivery in at most 3 shots': 'Сделайте доставку максимум за 3 выстрела',
  'Clear the depot in 65 seconds': 'Очистите склад за 65 секунд',
  'Bridge Disaster': 'Авария на мосту',
  'Traffic report: a car is parked over two blastable piers.': 'Сводка: машина стоит над двумя взрывоопасными опорами.',
  'Drop a chosen span, use the loose car as a ram, and keep the tourist outside the collapse zone.': 'Сбросьте пролёт, используйте машину как таран и спасите туриста от обрушения.',
  'Keep the tourist safe': 'Сохраните туриста',
  'Castle Crash': 'Крушение замка',
  'A loose tank faces a fortress full of powder.': 'Одинокий танк смотрит на крепость с порохом.',
  'Drive shots through the tank, gate, corner towers, or courtyard drums and choose where the fortress opens.': 'Стреляйте по танку, воротам, башням или бочкам во дворе и выберите место обрушения.',
  'Win with at most 4 shots': 'Победите максимум за 4 выстрела',
  'Demolish 60% of the fortress': 'Разрушьте 60% крепости',
  'Factory Accident': 'Авария на фабрике',
  'A loaded machine line with a truck parked in front.': 'Загруженная линия станков и грузовик впереди.',
  'Hit a piston, belt drum, hanging weight, or the loose truck and let the factory chain reaction develop.': 'Ударьте по поршню, барабану, грузу или грузовику и запустите цепную реакцию.',
  'Start the accident with 2 items': 'Начните аварию с 2 предметов',
  'Shut down the shift in 75 seconds': 'Остановите смену за 75 секунд',
  'Tower Trouble': 'Башенная проблема',
  'Seven storeys, four feet, and a tank at street level.': 'Семь этажей, четыре опоры и танк на улице.',
  'Use the tank as cover or debris, light either flank drum, or attack a repeating tower bay directly.': 'Используйте танк как укрытие или обломок, взорвите бочку или атакуйте секцию башни.',
  'Use no more than 3 items': 'Используйте не более 3 предметов',
  'Collapse 65% of the tower': 'Обрушьте 65% башни',
  'EVERYTHING MUST GO': 'УНИЧТОЖИТЬ ВСЁ',
  'House, tower, skywalk, machines, tank, car. Pick a route.': 'Дом, башня, эстакада, станки, танк и машина. Выберите путь.',
  'Start from either vehicle, the hanging weight, the skywalk, or the machine drum and finish the compact yard your way.': 'Начните с машины, груза, эстакады или барабана и разрушьте двор по-своему.',
  'Keep Clipboard Kid standing': 'Сохраните малыша с планшетом',
  'Finish the big mess in 90 seconds': 'Завершите большой беспорядок за 90 секунд',
  'Tank Shell Cache': 'Запас танковых снарядов',
};

function translateValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return value;

  let translated = TERMS[trimmed] ?? trimmed;
  let match = /^LEVEL (\d+) COMPLETE$/.exec(trimmed);
  if (match) translated = `УРОВЕНЬ ${match[1]} ЗАВЕРШЁН`;
  match = /^LEVEL (\d+)$/.exec(trimmed);
  if (match) translated = `УРОВЕНЬ ${match[1]}`;
  match = /^Level (\d+)$/.exec(trimmed);
  if (match) translated = `УРОВЕНЬ ${match[1]}`;
  match = /^CHAPTER (\d+)$/.exec(trimmed);
  if (match) translated = `ГЛАВА ${match[1]}`;
  match = /^COMPLETE LEVEL (\d+) TO UNLOCK$/.exec(trimmed);
  if (match) translated = `ЗАВЕРШИТЕ УРОВЕНЬ ${match[1]}`;
  match = /^FINISH LEVEL (\d+)$/.exec(trimmed);
  if (match) translated = `ЗАВЕРШИТЕ УРОВЕНЬ ${match[1]}`;
  match = /^Best (.+)$/.exec(trimmed);
  if (match) translated = `РЕКОРД ${match[1]}`;
  match = /^(\d+) of 3 stars$/.exec(trimmed);
  if (match) translated = `${match[1]} из 3 звёзд`;
  match = /^USE NO MORE THAN (\d+) (?:HEAVY BALLS?|ITEMS?|PIECES?)$/.exec(trimmed);
  if (match) translated = `ИСПОЛЬЗУЙТЕ НЕ БОЛЕЕ ${match[1]} ПРЕДМ.`;
  match = /^FINISH IN (\d+) SECONDS$/.exec(trimmed);
  if (match) translated = `ЗАВЕРШИТЕ ЗА ${match[1]} СЕК.`;
  match = /^\+(\d+) PROP DAMAGE · (.+)$/.exec(trimmed);
  if (match) translated = `+${match[1]} УРОНА ПРЕДМЕТУ · ${TERMS[match[2]] ?? match[2]}`;
  match = /^\+(\d+) DAMAGE · (.+)$/.exec(trimmed);
  if (match) translated = `+${match[1]} УРОНА · ${TERMS[match[2]] ?? match[2]}`;
  match = /^(\d+) KILLS? · (.+)$/.exec(trimmed);
  if (match) translated = `${match[1]} УБИЙСТВ · ${TERMS[match[2]] ?? match[2]}`;
  match = /^(\d+) \/ (\d+) STARS$/.exec(trimmed);
  if (match) translated = `${match[1]} / ${match[2]} ЗВЁЗД`;
  match = /^([A-Z ]+) · (.+)$/.exec(trimmed);
  if (match && TERMS[match[1]]) translated = `${TERMS[match[1]]} · ${TERMS[match[2]] ?? match[2]}`;

  if (translated === trimmed && trimmed === 'Local') translated = 'Локально';
  if (translated === trimmed && trimmed === 'CrazyGames') translated = 'CrazyGames';
  if (translated === trimmed && trimmed === 'Yandex Games') translated = 'Яндекс Игры';
  if (translated === trimmed) return value;
  return value.replace(trimmed, translated);
}

function translateTree(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current: Node | null;
  while ((current = walker.nextNode())) textNodes.push(current as Text);
  for (const node of textNodes) {
    const value = node.nodeValue ?? '';
    const translated = translateValue(value);
    if (translated !== value) node.nodeValue = translated;
  }

  root.querySelectorAll<HTMLElement>('*').forEach((element) => {
    for (const attribute of ['aria-label', 'title', 'placeholder']) {
      const value = element.getAttribute(attribute);
      if (value) {
        const translated = translateValue(value);
        if (translated !== value) element.setAttribute(attribute, translated);
      }
    }
  });
}

export interface LocaleController {
  setLanguage(language?: string): void;
  dispose(): void;
}

/** Activates Russian only for the Yandex build/host. CrazyGames stays English. */
export function installRussianLocale(root: HTMLElement): LocaleController {
  const query = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  const russian = platformService.kind === 'yandex' || query?.get('lang') === 'ru' || query?.get('locale') === 'ru';
  if (!russian) return { setLanguage: () => undefined, dispose: () => undefined };

  document.documentElement.lang = 'ru';
  let applying = false;
  let queued = false;
  const apply = (): void => {
    if (applying) return;
    applying = true;
    translateTree(root);
    applying = false;
  };
  const observer = new MutationObserver(() => {
    if (applying || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      apply();
    });
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'title', 'placeholder'] });
  apply();
  return {
    setLanguage: (language?: string): void => {
      const detected = (language ?? 'ru').toLowerCase().split('-')[0] || 'ru';
      // Russian is the declared Yandex localization. Unsupported portal
      // languages intentionally fall back to it, while still recording the
      // SDK-detected code for the platform's i18n check.
      document.documentElement.dataset.i18nLanguage = detected;
      document.documentElement.lang = 'ru';
      apply();
    },
    dispose: () => observer.disconnect(),
  };
}
