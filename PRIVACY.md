# Privacy

Belay is software you host yourself or use on an instance someone else runs.
The project behind it runs no instance of its own, and no app sends anything
to the project: nothing leaves your device except to the instance you sign in
to.

## Who holds your data

The operator of the instance is the controller of what it holds. The instance serves the operator's e-mail address or web page, how to reach them about your data,
where the data is kept and how long they keep backups, whatever they chose to
state. The
administrator of an instance can technically read its data: Belay does not
encrypt it end to end. Use an instance run by someone you trust.

## What an instance keeps

From your identity provider, an identifier and a display name, never your
e-mail address. Then what you enter: sessions, sets, weigh-ins and the rest of
your training log.

## Consent before anything is sent

Signing in stores your identifier and display name; the instance accepts none
of your records until you agree to its current notice.
Your agreement is recorded with the version of the notice and the time. When
the notice changes, it asks again.

## Deleting your account

You can delete your account from your own session. It erases the account and
every row tied to it at once, and ends your sessions. Your other signed-in
devices are told so on their next call, so they can erase their local copy. The instance
logs only your account's internal identifier and the time of the deletion.

The operator keeps backups for the time they state. A backup restored later
would bring your data back, so an operator is expected to delete it again
after a restore, from that log.
