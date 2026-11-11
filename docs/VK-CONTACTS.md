# VK ID: e-mail и телефон в Logto

Это дополнение к инструкции по коннектору. Оно объясняет, почему VK-профиль может приходить
без e-mail/телефона, что исправлено в коннекторе и как проверить результат.

## 1. Почему контактов не было

Коннектор по умолчанию запрашивает только `vkid.personal_info` (id, имя, аватар).
E-mail и телефон VK отдаёт только при **одновременном** выполнении трёх условий:

1. соответствующее разрешение включено в кабинете приложения VK ID;
2. в Logto включён переключатель **Sync e-mail** / **Sync phone number**;
3. в запросе авторизации передан scope `email` / `phone`.

Раньше третье условие приходилось выставлять вручную в поле `scope`. Если админ включал
переключатель, но забывал дописать scope, профиль приходил без контактов — без ошибки.

## 2. Что изменено

- `addContactScopes()` автоматически добавляет `email` и/или `phone` в scope, если включён
  соответствующий sync-переключатель. Повторного добавления нет.
- Телефон в локальном российском формате `8XXXXXXXXXX` нормализуется в `+7XXXXXXXXXX`
  (раньше такое значение отбрасывалось).
- В лог Logto добавляется диагностика без значений:
  `[vkid] authorize scope: ...` и `[vkid] user_info presence: {"email":...,"phone":...,"token_scope":...}`.

## 3. Настройка Logto

В **Logto Console → Connectors → VK**:

| Поле              | Значение                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| Scope             | `vkid.personal_info email phone` (или оставьте `vkid.personal_info`: sync-переключатели добавят нужное) |
| Sync e-mail       | включить, если e-mail должен попадать в Logto                                                           |
| Sync phone number | включить, если телефон должен попадать в Logto                                                          |

`sync_profile` у коннектора должен быть включён, чтобы профиль обновлялся при повторных входах,
а не только при регистрации.

## 4. Настройка VK ID

В кабинете VK ID приложение должно разрешать `email`/`phone`. Для `phone`, по документации
VK ID, нужен подтверждённый бизнес-профиль. Если VK не разрешает scope, он не вернёт поле,
даже если коннектор его запрашивает.

## 5. Проверка

После свежего входа через VK (не из старой сессии Logto):

```bash
docker logs logto-logto-1 2>&1 | grep '\[vkid\]' | tail
```

Ожидаемые строки:

```text
[vkid] authorize scope: vkid.personal_info email phone
[vkid] user_info presence: {"email":true,"phone":false,"token_scope":"email vkid.personal_info",...}
```

- `email=true` и `phone=false` означает, что VK выдал e-mail, но не телефон: проблема на стороне
  разрешений VK ID, а не коннектора.
- Если `token_scope` не содержит `email`/`phone`, VK не выдал scope — проверьте кабинет VK ID.

## 6. Деплой образа

Полная сборка (канонический `Dockerfile`):

```bash
docker build -t ozvix/logto-vkid:1.46.0-vkid.2 .
```

Если нужно обновить только бандл коннектора поверх уже собранного образа Logto:

```bash
# lib/ получен через `npm run build`
docker build -f deploy/Dockerfile.connector-lib \
  --build-arg BASE_IMAGE=ozvix/logto-vkid:1.46.0-vkid.1 \
  -t ozvix/logto-vkid:1.46.0-vkid.2 .
```

Затем обновите `image` в `/opt/logto/compose.yaml` и выполните:

```bash
cd /opt/logto
docker compose -f compose.yaml up -d logto
```

Перед пересозданием сделайте backup БД и compose. После деплоя проверьте лог загрузки
коннектора и `[vkid]`-диагностику.
