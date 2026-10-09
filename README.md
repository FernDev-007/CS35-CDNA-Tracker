# CDNA Tracker

A board showing everyone's Closed Door No AMI (CDNA) balance by class year, a **Request CDNA** button that checks the rules and produces a filled-in Form 10, and an admin page for awarding CDNAs and managing the roster.

- `index.html`: the board (this is what goes in Teams)
- `admin.html`: the admin page (award, probation, refunds, roster, history)
- `supabase/schema.sql`: the database, its rules, and its security
- `supabase/roster.sql`: your 101-person roster, ready to load
- `assets/form10-template.pdf`: the Form 10 the site fills in

Setup takes about 20 minutes. You only do it once.

---

## 1. Set up the database (Supabase)

1. In Supabase, click **New project**. Any name works (for example `cdna-tracker`). Save the database password somewhere safe. Pick the **West US** region if offered.
2. Open `supabase/schema.sql` in a text editor. At the very bottom, change `your.email@afacademy.af.edu` to the email you'll use to sign in to the admin page. To add more admins, add more lines:
   ```sql
   insert into public.admins (email) values
     ('first.admin@afacademy.af.edu'),
     ('second.admin@afacademy.af.edu');
   ```
3. In Supabase, go to **SQL Editor**, click **New query**, paste the whole of `schema.sql`, and click **Run**. You should see "Success. No rows returned."
4. Make another new query, paste the whole of `supabase/roster.sql`, and click **Run**. This adds all 101 people with 0 CDNAs each.

## 2. Create the admin sign-ins

1. Go to **Authentication > Users**, then **Add user > Create new user**.
2. Enter the same email you put in `schema.sql`, choose a password, and keep **Auto Confirm User** checked.
3. Repeat for each admin.
4. Go to **Authentication > Sign In / Providers** and turn **off** "Allow new users to sign up". Admins are only ever added by you.

## 3. Connect the website to the database

1. In Supabase, open **Project Settings > Data API** and copy the **Project URL**.
2. Open **Project Settings > API Keys** and copy the **Publishable key** (or the older **anon public** key).
3. Open `js/config.js` and paste them in:
   ```js
   export const SUPABASE_URL = 'https://abcdefghijk.supabase.co';
   export const SUPABASE_KEY = 'sb_publishable_...';
   ```
   This key is meant to be public; the database rules are what keep the data safe. **Never** paste the `secret` or `service_role` key here.

## 4. Put it on GitHub Pages

1. On GitHub, click **New repository**, name it (for example `cdna-tracker`), and make it **Public**. GitHub Pages is free for public repos.
2. On the new repo's page, click **uploading an existing file**. Drag in **everything inside** this folder (`index.html`, `admin.html`, and the `css`, `js`, `assets` and `supabase` folders), then click **Commit changes**.
3. Go to **Settings > Pages**. Under **Build and deployment**, choose **Deploy from a branch**, then branch **main** and folder **/ (root)**, then **Save**.
4. After a minute or two the page shows your link, like `https://your-username.github.io/cdna-tracker/`. Open it and check the board loads.

## 5. Add it to Teams

1. In your Teams channel, click **+** at the top (Add a tab) and choose **Website**.
2. Name it `CDNA Board` and paste the GitHub Pages link.
3. Test a request inside Teams, on desktop and on a phone. If the Form 10 doesn't download inside Teams, the success screen has a **Download Form 10** link and an **open it in a new tab** link, and the bottom of the board has an **Open this page in your browser** link.

The admin page is the same link with `admin.html` on the end, for example `https://your-username.github.io/cdna-tracker/admin.html`. Bookmark it; it isn't linked from the board.

---

## How requests work

1. The cadet clicks **Request CDNA** and types their email. If it's not on the roster, the request stops there.
2. They choose **Single day** or **Multiple days** and pick the days.
3. They review and click **Use N CDNAs**.
4. If every rule passes, the CDNAs are taken off their balance, the days are recorded, and their Form 10 downloads. If any rule fails, they see **"You can't use this CDNA"** with every reason listed, and nothing is used.

The rules are checked twice: instantly on the page, and again by the database, which has the final say. Someone who tampers with the page still can't break the rules.

| Rule | What the cadet sees |
|---|---|
| Email must be on the roster | That email isn't on the roster. Check the spelling, or ask an admin to add you. |
| Not on probation | You can't use a CDNA while on probation. |
| No past days (today is fine, Mountain time) | CDNA days can't be in the past (Mon 5 Oct). |
| Weekdays only | CDNAs can only be used on weekdays (Sat 10 Oct is a weekend). |
| Multiple days must be back-to-back weekdays (Friday then Monday counts) | Multi-day CDNAs must be back-to-back weekdays (there's a gap between Mon 12 Oct and Wed 14 Oct). |
| Can't book a day twice | You already have a CDNA on Tue 13 Oct. |
| Balance above 0 | You don't have any CDNAs left. |
| Enough CDNAs for every day | This request needs 3 CDNAs but you only have 2. |

### The Form 10

The site fills these blocks on your template and leaves everything else as it is:

- **1. Cadet name:** `LAST, FIRST, MI` (for example `WOOD, AARON, M`)
- **3. Class year**
- **4. Date** and **VI-8. Date awarded:** the day of the request (`MM/DD/YY`)
- **Narrative:** for example *Cadet Wood, based on performance, has earned a Closed Door No AMI on 12 Oct through 14 Oct.* Two days reads "09 Oct and 12 Oct"; one day reads "09 Oct".

The rest of the form stays fillable, so it can still be initialed and signed. To change the wording, edit `js/form10.js`. To use a new version of the form, replace `assets/form10-template.pdf`; it must have the same field layout.

---

## Admin page

Sign in with the email and password from step 2.

- **Award CDNAs:** Tick one or more people (or **Select all** for a class), choose how many, and enter a reason; the reason is required. Switch **Action** to **Remove** to take CDNAs away; a balance can't go below 0.
- **Roster:**
  - **Add** or **Edit** a person.
  - **Probation** turns requests off for that person until you click **End probation**. Their balance stays the same.
  - **Remove** hides them from the board and blocks requests, but keeps their history. Tick **Show removed** to see and **Restore** them.
  - **Import roster** takes a CSV in the same layout as the original. New emails are added with 0 CDNAs; existing emails get their name and class updated. Balances are never touched by an import.
- **History:** Every CDNA earned, used, refunded or removed, plus probation changes, with who did it and when. You can filter by name, class, type and date, and click **Export CSV** to download the filtered list.
  - **Form 10** re-downloads the form for any used CDNA.
  - **Refund** undoes a used CDNA. It gives the CDNAs back and frees the days, with a required reason.
  - History entries can't be edited or deleted; a refund or removal is recorded as a new entry.

## Yearly upkeep

When a class graduates:
1. Remove those people on the **Roster** tab.
2. Edit `CLASS_YEARS` in `js/config.js`, for example `[2031, 2030, 2029, 2028]`, and upload the changed file to GitHub.
3. Import the new class's roster.

## Good to know

- **Free Supabase projects pause after about a week with no activity**, for example over winter or summer break. If the board says it couldn't load, open the project in Supabase and click **Restore**. Nothing is lost.
- **Requests only need an email, as you chose.** That means someone who knows another cadet's email could spend their CDNA. Every use is in the history log, and an admin can refund it in two clicks.
- **The board is public to anyone with the link.** It shows names, class years and balances. Emails and probation status are only visible on the admin page.
- **Fixed roster entries:** two emails in the original CSV had typos and were corrected in `roster.sql`:
  - `c27grant,yost@` became `c27grant.yost@`
  - `afacadmey.af.edu` became `afacademy.af.edu` (Mehaffy)
- **Roster entries to double-check:** these were loaded as written and can be fixed on the Roster tab:
  - `c30addion.hilliard@...` (Addison or Addion?)
  - `C28isabellachristensen@...` (no dot between first and last name)
