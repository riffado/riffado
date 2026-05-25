CREATE TABLE "install_script_hits" (
	"day" date NOT NULL,
	"version" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "install_script_hits_day_version_pk" PRIMARY KEY("day","version")
);
