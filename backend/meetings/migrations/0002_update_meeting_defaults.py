from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('meetings', '0001_initial'),
    ]

    operations = [
        migrations.AlterField(
            model_name='meeting',
            name='title',
            field=models.CharField(default='Quick YLAAM-MEET Meeting', max_length=200),
        ),
    ]
